sap.ui.define(
  [
    "sap/ui/model/json/JSONModel",
    "kreuzwort/kreuzwort/util/Dummy",
    "kreuzwort/kreuzwort/util/Field",
  ],
  function (JSONModel, Dummy, Field) {
    "use strict";

    return class Generator {
      constructor(controllerRef) {
        this.controller = controllerRef;
        this.grid = [];
        this.dummys = [];
        // Sentinel-Key für forcedBy-Einträge, die nicht von einem einzelnen
        // (entfernbaren) Dummy stammen, sondern aus der Grid-Struktur selbst
        // erzwungen werden (siehe _markNewForcedFields).
        this._structuralForceKey = Symbol("structuralForce");
      }

      init() {
        let settings = this.controller.getView().getModel("settings");
        this.height = settings.getProperty("/height");
        this.width = settings.getProperty("/width");
        this.maxLength = settings.getProperty("/maxLength");
        if (this.height < 5) {
          this.height = 5;
        }
        if (this.width < 5) {
          this.width = 5;
        }

        this.eval = {
          finished: 0,
          partial: 0,
          empty: this.height * this.width,
        };
        this.reset();
      }

      reset() {
        this.dummys = [];
        this.resetWordHighlighting();
        this.refreshSettings();
        this.resetGrid();
        this._shapeFirstDummy();
        this.controller.setGrid(this.getGrid());
      }

      resetWordHighlighting() {
        this.hideCurrentWord();
      }

      refreshSettings() {
        let settings = this.controller.getView().getModel("settings");
        this.height = settings.getProperty("/height");
        this.width = settings.getProperty("/width");
        this.maxLength = settings.getProperty("/maxLength");
        if (this.height < 5) {
          this.height = 5;
        }
        if (this.width < 5) {
          this.width = 5;
        }
      }

      // Liefert null für Koordinaten außerhalb des Grids
      getField(x, y) {
        if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
          return this.grid[y][x];
        }
        return null;
      }

      getLastDummy() {
        return this.dummys[this.dummys.length - 1];
      }

      // Der Feld-Zustand (Inhalt, Marker, abgeleitete Flags) wird in der
      // Field-Klasse verwaltet. Für Marker, die aus der Grid-Struktur selbst
      // entstehen (nicht an einen einzelnen Dummy gebunden), wird
      // this._structuralForceKey als owner verwendet.

      // true, wenn das Feld durch etwas anderes als die strukturelle Ableitung
      // selbst reserviert ist (also durch einen echten, platzierten Dummy).
      // Nur in diesem Fall ist die Position wirklich "extern" schon geklärt.
      // Ist ein Feld ausschließlich über structuralForceKey reserviert, soll
      // es bei jeder Neuermittlung weiterhin als offener Kandidat gelten,
      // damit _getForcedFields()/_getEncasedFields() bei jedem Aufruf den
      // vollständigen, aktuell korrekten Stand liefern (nicht nur neu
      // hinzugekommene Fälle) und sich so für einen Abgleich eignen.
      _isReservedByOther(field) {
        return field.isForcedByOtherThan(this._structuralForceKey);
      }

      // Grid ist fertig, wenn kein Feld mehr leer ist, also jedes Feld ein Hinweis-
      // oder Buchstabenfeld ist
      isFinished() {
        return this.grid.every((row) => row.every((field) => !field.isEmpty));
      }

      step() {
        // Fertige Grids nicht weiter verändern (sonst können Validierung/Reshaping
        // ein bereits volles Grid wieder aufbrechen)
        if (this.isFinished()) {
          console.log("GRID FINISHED");
          return;
        }

        let that = this,
          location,
          dummy,
          forcedLocations = this._getForcedDummyLocations(),
          optionalLocations = this._getOptionalDummyLocations();
        this.forcedDummys = [];

        // Forcierte Hinweisfelder haben Vorrang
        if (forcedLocations.length > 0) {
          forcedLocations.forEach(function (field) {
            that.forcedDummys.push(new Dummy(field.x, field.y, that));
          });

          that.forcedDummys.sort(function (a, b) {
            return a.possibilities.length - b.possibilities.length;
          });

          if (that.forcedDummys[0].possibilities.length === 0) {
            console.log("FORCED DUMMY HAS NO POSSIBILITIES");

            this.getLastDummy().shape();
          } else {
            location = forcedLocations[0];
          }
        }

        // Optionale Felder
        else if (optionalLocations.length > 0) {
          // Sortieren nach Anzahl angrenzender Hinweisfelder

          optionalLocations.sort(function (a, b) {
            let adjClueDiff = that._getAdjClues(a) - that._getAdjClues(b);
            if (adjClueDiff !== 0) {
              return adjClueDiff;
            }

            return b.score - a.score;
          });
          location = optionalLocations[0];
        } else {
          console.log("NO MARKED LOCATIONS LEFT");
          for (let y = 0; y < that.height; y++) {
            for (let x = 0; x < that.width; x++) {
              if (that.grid[y][x].isEmpty) {
                that.grid[y][x].mark(that._structuralForceKey, {
                  forced: false,
                });
                this.step();
              }
            }
          }
          return;
        }

        if (location != null) {
          dummy = new Dummy(location.x, location.y, that);
          dummy.shape();
        }

        // this.updateGrid();

        this._validateGrid();
        this._markStructuralForcedFields();

        this.updateGrid();

        console.log("------------------------------------------------");
      }

      // Ermittelt, welche Dummys für ein konfliktverursachendes Feld verantwortlich
      // sind (Wort auf dem Feld selbst, oder - bei leeren "unmöglichen" Feldern wie
      // bei Randkonstellationen - die Wörter auf den direkten Nachbarfeldern).
      _getResponsibleDummys(field) {
        let dummys = new Set();
        let addFromField = (f) => {
          if (!f) return;
          if (f.clueFor) dummys.add(f.clueFor);
          if (f.dummyHorizontal) dummys.add(f.dummyHorizontal);
          if (f.dummyVertical) dummys.add(f.dummyVertical);
          f.forcedBy.forEach((d) => {
            if (d instanceof Dummy) dummys.add(d);
          });
        };
        addFromField(field);
        if (field.isEmpty) {
          let x = field.x,
            y = field.y;
          if (x > 0) addFromField(this.grid[y][x - 1]);
          if (x < this.width - 1) addFromField(this.grid[y][x + 1]);
          if (y > 0) addFromField(this.grid[y - 1][x]);
          if (y < this.height - 1) addFromField(this.grid[y + 1][x]);
        }
        return dummys;
      }

      // Wählt aus den für die gegebenen Konfliktfelder verantwortlichen Dummys
      // denjenigen aus, der zeitlich zuletzt platziert wurde - das minimiert,
      // wie viel vom bisher aufgebauten Grid durch das Reshapen verworfen wird.
      // Kann kein verantwortlicher Dummy ermittelt werden, wird wie bisher der
      // zuletzt platzierte Dummy insgesamt genommen.
      _pickBacktrackTarget(fields) {
        let that = this;
        let candidates = new Set();
        let best = null;
        let bestIndex = -1;

        if (fields && fields.length > 0) {
          fields.forEach((field) => {
            that._getResponsibleDummys(field).forEach((d) => candidates.add(d));
          });

          candidates.forEach((d) => {
            let idx = that.dummys.indexOf(d);
            if (idx > bestIndex) {
              bestIndex = idx;
              best = d;
            }
          });
        }
        return best || this.getLastDummy();
      }

      _validateGrid() {
        // Gesetzte Buchstabenfelder suchen, die in der verbleibenden Richtung
        // keine Möglichkeit mehr haben, einem Wort zugeordnet zu werden.

        // TODO: in getConstraints anpassen, sodass geprüft wird, ob ein Feld von horizontal & vertikal
        // als einzige Möglichkeit geforced wird. Dann Logik überlegen, wie man das Ganze auflösen kann.
        let constraints = this._getDirectionConstraints();
        if (constraints.length > 0) {
          console.log("Impossible to fill:", constraints);
          // Dummy hat keine Möglichkeiten mehr für neue Formen offen
          if (this._pickBacktrackTarget(constraints).shape()) {
            console.log("Backtrack target has no possibilities left");
          }
          this._validateGrid();
        } else {
          // console.log("OK letters");
        }

        // Experimentell: Maximale Anzahl an benachbarten (auch diagonal) liegenden Hinweisfeldern
        if (
          this.controller
            .getView()
            .getModel("settings")
            .getProperty("/adjClueLimitOn")
        ) {
          let clueClumps = this._validateClueClumps();
          if (clueClumps.length > 0) {
            console.log("TOO MANY ADJACENT CLUE FIELDS FOUND: ", clueClumps);
            this._pickBacktrackTarget(clueClumps.flat()).shape();
            this._validateGrid();
          } else {
            // console.log("OK clues");
          }
        }

        let impossibleEdges = this._validateEdges();
        if (impossibleEdges.length > 0) {
          console.log("IMPOSSIBLE EDGES FOUND: ", impossibleEdges);
          // 1.Versuch: Konstellation fixen
          if (!this._fixEdges(impossibleEdges)) {
            // 2. Versuch: den Dummy, der die Konstellation verursacht neu generieren
            this._pickBacktrackTarget(impossibleEdges).shape();
          }
          this._validateGrid();
        } else {
          // console.log("OK edges");
        }

        let blockedFields = this._getBlockedFields();
        if (blockedFields.length > 0) {
          console.log("BLOCKED FIELDS FOUND: ", blockedFields);
          this._pickBacktrackTarget().shape();
          this._validateGrid();
        }
      }

      _fixEdges(impossibleEdges) {
        // impossibleEdges enthält die Randfeld(er), welche nicht befüllt werden können. Die Idee
        // ist, eines der angrenzenden Hinweisfelder zu entfernen, und das Wort, welches von diesem
        // Feld ausgeht, um 1 zu verlängern und vom "unmöglichen" Feld aus zu starten.
        let left, right, below, above;
        let that = this;
        let possible = true;
        let fixes = [];

        // Das unmögliche Feld kann direkt am Rand liegen (z.B. in der Ecke oben rechts),
        // daher alle Nachbarn über getField() holen, das außerhalb des Grids null liefert
        let clueAt = function (x, y) {
          let field = that.getField(x, y);
          return field ? field.clueFor : null;
        };
        let reservedAt = function (x, y) {
          let field = that.getField(x, y);
          return field !== null && field.reserved;
        };

        // TODO TODO TODO
        impossibleEdges.forEach(function (f) {
          // Oberer Rand
          if (f.y === 0) {
            left = clueAt(f.x - 1, f.y);
            right = clueAt(f.x + 1, f.y);
            below = clueAt(f.x, f.y + 2);

            if (
              left &&
              left.direction === "down" &&
              left.length < that.maxLength &&
              reservedAt(f.x - 2, f.y)
            ) {
              fixes.push({ field: f, replace: left, direction: "leftdown" });
            } else if (
              right &&
              right.direction === "down" &&
              right.length < that.maxLength &&
              reservedAt(f.x + 2, f.y)
            ) {
              fixes.push({ field: f, replace: right, direction: "rightdown" });
            } else {
              possible = false;
            }
          }
          // Linker Rand
          else {
            above = clueAt(f.x, f.y - 1);
            below = clueAt(f.x, f.y + 1);
            right = clueAt(f.x + 2, f.y);
            if (
              above &&
              above.direction === "right" &&
              above.length < that.maxLength &&
              reservedAt(f.x, f.y - 2)
            ) {
              fixes.push({ field: f, replace: above, direction: "upright" });
            } else if (
              below &&
              below.direction === "right" &&
              below.length < that.maxLength &&
              reservedAt(f.x, f.y + 2)
            ) {
              fixes.push({ field: f, replace: below, direction: "downright" });
            } else {
              possible = false;
            }
          }
        });

        if (possible) {
          let replacedDummys = new Set();
          let applied = false;
          fixes.forEach(function (fix) {
            // Mehrere unmögliche Felder können denselben Dummy ersetzen wollen (z.B. ein
            // Hinweisfeld am linken Rand zwischen zwei unmöglichen Feldern). Nur der erste
            // Fix wird angewendet, verbleibende unmögliche Felder werden beim nächsten
            // Durchlauf von _validateGrid erneut erkannt.
            if (replacedDummys.has(fix.replace)) {
              return;
            }
            replacedDummys.add(fix.replace);

            let index = that.dummys.indexOf(fix.replace);
            that.removeDummyFromGrid(fix.replace);
            let newDummy = new Dummy(fix.field.x, fix.field.y, that);
            newDummy.shape(false, fix.direction, fix.replace.length + 1);

            if (newDummy.shaped) {
              applied = true;
            } else {
              // Fix nicht möglich: ursprünglichen Dummy an seiner alten Position in der
              // Reihenfolge wiederherstellen (relevant für _pickBacktrackTarget)
              that.addDummyToGrid(fix.replace);
              that.dummys.splice(that.dummys.indexOf(fix.replace), 1);
              that.dummys.splice(index, 0, fix.replace);
            }
          });
          // Wurde kein Fix angewendet, muss der Aufrufer per Backtracking reagieren
          return applied;
        }
        return false;
      }

      _getBlockedFields() {
        let blocked = [];
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (!field.isEmpty) {
              return;
            }
            if (field.edges + field.blocked === 4) {
              blocked.push(field);
            }
          });
        });

        return blocked;
      }

      _markStructuralForcedFields() {
        // Ermittelt die aktuell korrekte Menge an strukturell erzwungenen
        // Feldern neu (_getForcedFields/_getEncasedFields sind dank
        // _isReservedByOther bei jedem Aufruf stabil/vollständig, nicht nur
        // additiv) und gleicht sie mit dem bisherigen structuralForceKey-Stand
        // ab: alles, was nicht mehr in der aktuellen Menge ist, wird entmarkiert,
        // alles darin enthaltene markiert.
        let that = this;
        let forcedFields = this._getForcedFields();
        let encasedFields = this._getEncasedFields();
        let oppositeForcedFields = this._getOppositeForcedFields();
        let edgeForcedFields = this._getEdgeForcedFields();

        forcedFields = forcedFields.concat(
          encasedFields,
          oppositeForcedFields,
          edgeForcedFields,
        );
        let forcedFieldKeys = new Set(
          forcedFields.map((field) => field.x + "," + field.y),
        );

        // aktuelle strukturell bedingte reservierte felder wieder entmarkieren
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (
              field.forcedBy.has(that._structuralForceKey) &&
              !forcedFieldKeys.has(field.x + "," + field.y)
            ) {
              field.unmark(that._structuralForceKey);
            }
          });
        });

        forcedFields.forEach(function (field) {
          field.mark(that._structuralForceKey, { forced: true });
        });

        if (forcedFields.length > 0) {
          console.log("Updated fields to FORCED", forcedFields);
        }
      }

      _getForcedFields() {
        let that = this;
        let forcedFields = [];
        let forcedFieldKeys = new Set();
        let checkedFields = new Set();

        for (let y = that.height - 1; y >= 0; y--) {
          for (let x = that.width - 1; x >= 0; x--) {
            let field = that.grid[y][x];
            let orientation = null;
            let result;

            if (!field.isLetter) {
              continue;
            }

            // Feld wurde bereits geprüft, daher skippen
            if (checkedFields.has(field.x + "," + field.y)) {
              continue;
            }

            if (field.hasVerticalWord && !field.hasHorizontalWord) {
              orientation = "horizontal";
              result = that._findForcedField(field, orientation);
            } else if (field.hasHorizontalWord && !field.hasVerticalWord) {
              orientation = "vertical";
              result = that._findForcedField(field, orientation);
            }
            // Feld hat bereits in beiden Richtungen ein Wort
            else {
              continue;
            }

            let candidate = result.candidate;
            result.checkedFields.forEach((key) => {
              checkedFields.add(key);
            });

            if (!candidate) {
              continue;
            }

            // Nur wenn 2 oder mehr Felder nebeneinander/übereinander auf dasselbe Feld zeigen wird
            // dieses forciert.
            if (result.checkedFields.size > 1) {
              forcedFieldKeys.add(
                candidate.x + "," + candidate.y + "," + orientation,
              );
            }
          }
        }

        forcedFieldKeys.forEach((key) => {
          let parts = key.split(",");
          let candidateX = parseInt(parts[0], 10);
          let candidateY = parseInt(parts[1], 10);
          let orientation = parts[2];
          let candidate = this.grid[candidateY][candidateX];

          if (this._canForceField(candidate, forcedFieldKeys, orientation)) {
            forcedFields.push(candidate);
          }
        });
        return forcedFields;
      }

      _getEncasedFields() {
        // returns empty Fields that are surrounded by 3 Clue fields and/or edges of the grid in
        // the following constellations:
        // |   | C |   |            |   | C |   |
        // | C | x | C |            | C | X |   |
        // |   |   |   |            |   | C |   |
        let encased = [];

        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (!field.isEmpty) {
              return;
            }
            // count adjacent edges/clue fields
            if (field.edges + field.clues !== 3) {
              return;
            }

            let below = field.below;
            let right = field.right;

            // check, if the open side is below or to the right
            if (below && !below.isClue) {
              encased.push(field);
            } else if (right && !right.isClue) {
              encased.push(field);
            }
          });
        });

        return encased;
      }

      _getOppositeForcedFields() {
        let that = this;
        let opposites = [];
        this.dummys.forEach(function (dummy) {
          let y = dummy.y;
          let x = dummy.x;
          let valid = true;

          if (
            that.grid[y + 1] &&
            that.grid[y + 1][x].isLetter &&
            that.grid[y + 2] &&
            that.grid[y + 2][x].isEmpty
          ) {
            if (x > 0 && that.grid[y + 1][x - 1].isEmpty) {
              valid = false;
            }
            if (x < that.width - 1 && that.grid[y + 1][x + 1].isEmpty) {
              valid = false;
            }
            if (valid) {
              opposites.push(that.grid[y + 2][x]);
            }
          }

          valid = true;

          if (
            that.grid[y][x + 1] &&
            that.grid[y][x + 1].isLetter &&
            that.grid[y][x + 2] &&
            that.grid[y][x + 2].isEmpty
          ) {
            if (y > 0 && that.grid[y - 1][x + 1].isEmpty) {
              valid = false;
            }
            if (y < that.height - 1 && that.grid[y + 1][x + 1].isEmpty) {
              valid = false;
            }
            if (valid) {
              opposites.push(that.grid[y][x + 2]);
            }
          }
        });
        return opposites;
      }

      _getEdgeForcedFields() {
        // Liegt in der zweiten Spalte/Zeile ein (zukünftiges) Hinweisfeld (C), kann das
        // leere Randfeld (#) davor kein Wort mehr bekommen: Am Rand sind keine parallel
        // verlaufenden Wörter erlaubt und das Wort quer dazu wäre direkt durch das
        // Hinweisfeld blockiert. Das Randfeld muss daher selbst ein Hinweisfeld werden.
        //  _______          _____
        // |#|C| | |        |#| | |
        // | | | | |        |C| | |
        //                  | | | |
        let edgeForced = [];
        for (let y = 0; y < this.height; y++) {
          let edgeField = this.grid[y][0];
          if (edgeField.isEmpty && this.grid[y][1].isClueOrReserved) {
            edgeForced.push(edgeField);
          }
        }
        for (let x = 0; x < this.width; x++) {
          let edgeField = this.grid[0][x];
          if (edgeField.isEmpty && this.grid[1][x].isClueOrReserved) {
            edgeForced.push(edgeField);
          }
        }
        return edgeForced;
      }

      _canForceField(field, forcedFieldKeys, orientation) {
        let above = null;
        let below = null;
        let left = null;
        let right = null;

        if (orientation === "horizontal") {
          if (field.y > 0) {
            above = this.grid[field.y - 1][field.x];
          }
          if (field.y < this.height - 1) {
            below = this.grid[field.y + 1][field.x];
          }

          if (
            above &&
            !above.isClue &&
            above.nextWordLocation &&
            !this._isReservedByOther(above)
          ) {
            if (!forcedFieldKeys.has(above.x + "," + above.y + ",horizontal")) {
              return false;
            }
          } else if (above && !above.isClue && this._isReservedByOther(above)) {
            return false;
          }

          if (
            below &&
            !below.isClue &&
            below.nextWordLocation &&
            !this._isReservedByOther(below)
          ) {
            if (!forcedFieldKeys.has(below.x + "," + below.y + ",horizontal")) {
              return false;
            }
          } else if (below && !below.isClue && this._isReservedByOther(below)) {
            return false;
          }
        } else {
          if (field.x > 0) {
            left = this.grid[field.y][field.x - 1];
          }
          if (field.x < this.width - 1) {
            right = this.grid[field.y][field.x + 1];
          }

          if (left && left.nextWordLocation && !this._isReservedByOther(left)) {
            if (!forcedFieldKeys.has(left.x + "," + left.y + ",vertical")) {
              return false;
            }
          } else if (left && !left.isClue && this._isReservedByOther(left)) {
            return false;
          }

          if (
            right &&
            right.nextWordLocation &&
            !this._isReservedByOther(right)
          ) {
            if (!forcedFieldKeys.has(right.x + "," + right.y + ",vertical")) {
              return false;
            }
          } else if (right && !right.isClue && this._isReservedByOther(right)) {
            return false;
          }
        }

        return true;
      }

      _findForcedField(field, orientation) {
        let x = field.x;
        let y = field.y;
        let targetIndex = orientation === "horizontal" ? x : y;
        let checkedFields = new Set();
        let that = this;
        let candidate = null;

        checkedFields.add(field.x + "," + field.y);

        for (let i = 1; i < that.maxLength && targetIndex - i >= 0; i++) {
          let current =
            orientation === "horizontal"
              ? that.grid[y][x - i]
              : that.grid[y - i][x];
          // Feld weitergehen, wenn es ein Buchstabenfeld ist. D.h. es liegen mehrere
          // Buchstaben nebeneinander/übereinander, bei denen noch ein horizontales/vertikales
          // Wort fehlt.
          if (current.isLetter) {
            checkedFields.add(current.x + "," + current.y);
            continue;
          }

          let reservedByOther = that._isReservedByOther(current);

          // Feld ist leer und kann daher selber als Hinweisfeld dienen, es muss also kein anderes
          // Feld markiert werden
          if (
            current.isEmpty &&
            !current.nextWordLocation &&
            !reservedByOther
          ) {
            candidate = null;
            break;
          }
          // Feld bereits durch etwas anderes als die Struktur des Rätsels
          //  reserviert (z.B. einen platzierten Dummy)
          if (current.isEmpty && reservedByOther) {
            candidate = null;
            break;
          }
          // Mögliches Hinweisfeld gefunden. Es kann sein, dass dieses dann später als forciertes
          // Feld hinterlegt wird. Es besteht aber auch die Möglichkeit, dass hinter dem gefundenen
          // Hinweisfeld ein weiteres liegt. Dann gibt es min. 2 Möglichkeiten für ein Wort
          // in dieser Richtung --> kann ignoriert werden.
          // Gilt auch, wenn das Feld aktuell schon ausschließlich strukturell
          // reserviert ist - das wird hier bei jedem Aufruf neu bestätigt statt
          // nur einmalig additiv gesetzt.
          if (current.isEmpty && current.nextWordLocation && !reservedByOther) {
            if (candidate != null) {
              candidate = null;
              break;
            }
            candidate = current;
            continue;
          }

          break;
        }

        return { candidate: candidate, checkedFields: checkedFields };
      }

      _validateClueClumps() {
        let invalidClumps = [];
        let visited = new Set();
        let maxAdjacentClues = this.controller
          .getView()
          .getModel("settings")
          .getProperty("/maxAdjacentClues");

        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            let field = this.grid[y][x];
            let key = x + "," + y;

            if (!field.isClue && !field.reserved) {
              continue;
            }

            if (visited.has(key)) {
              continue;
            }

            let clueClump = this._getClueClump(field, []);
            clueClump.forEach(function (clumpField) {
              visited.add(clumpField.x + "," + clumpField.y);
            });

            if (clueClump.length > maxAdjacentClues) {
              invalidClumps.push(clueClump);
            }
          }
        }

        return invalidClumps;
      }

      // Sammelt rekursiv alle Hinweisfelder (bzw. reservierten Felder), die
      // direkt oder diagonal zusammenhängend an das gegebene Feld angrenzen.
      _getClueClump(field, clueFields, visited) {
        if (!visited) {
          visited = new Set();
        }

        if (visited.has(field)) {
          return clueFields;
        }

        visited.add(field);
        clueFields.push(field);
        field.getSurroundingFields().forEach((neighbor) => {
          if (neighbor.isClueOrReserved) {
            clueFields = this._getClueClump(neighbor, clueFields, visited);
          }
        });

        return clueFields;
      }

      checkConstraintsForLetter(x, y, direction) {
        let valid = false;
        let i,
          current,
          above,
          below,
          left,
          right,
          that = this,
          horizontal = false;
        if (
          direction === "right" ||
          direction === "upright" ||
          direction === "downright"
        ) {
          horizontal = true;
        }
        // Vertikales Wort fehlt
        // --> Ausgehend vom aktuellen Feld nach oben gehen und nach einem freien
        // Feld suchen, in welchem noch ein Wort platziert werden kann.
        // Wenn es in dieser Richtung nur eine Möglichkeit gibt, diese als verpflichtend
        // kennzeichnen.
        if (horizontal) {
          for (i = 1; i < that.maxLength && y - i >= 0; i++) {
            current = that.grid[y - i][x];

            if (current.isClue || current.reserved) {
              valid = true;
              break;
            }

            if (y - i > 0) {
              above = that.grid[y - i - 1][x];
            } else {
              above = null;
            }

            if (current.isEmpty || current.hasVerticalWord) {
              valid = true;
              break;
            }
            // Hinweisfeld (C) oder Rand erreicht, welches in andere Richtung zeigt. Dann
            // die Felder links und rechts (X) vom aktuellen Feld checken.
            // |   | C |   |
            // | X | - | X |
            // |   | - |   |
            if ((above != null && above.isClue) || y - i == 0) {
              if (x > 0) {
                left = that.grid[y - i][x - 1];
                if (left.isEmpty) {
                  valid = true;
                }
              }
              if (x < that.width - 1) {
                right = that.grid[y - i][x + 1];
                if (right.isEmpty) {
                  valid = true;
                }
              }
              break;
            }
          }
        }
        // Horizontales Wort fehlt
        else {
          for (i = 1; i < that.maxLength && x - i >= 0; i++) {
            current = that.grid[y][x - i];
            if (current.isClue || current.reserved) {
              valid = true;
              break;
            }
            if (x - i > 0) {
              left = that.grid[y][x - i - 1];
            } else {
              left = null;
            }

            if (current.isEmpty || current.hasHorizontalWord) {
              valid = true;
              break;
            }

            if ((left != null && left.isClue) || x - i == 0) {
              if (y > 0) {
                above = that.grid[y - 1][x - i];
                if (above.isEmpty) {
                  valid = true;
                }
              }
              if (y < that.height - 1) {
                below = that.grid[y + 1][x - i];
                if (below.isEmpty) {
                  valid = true;
                }
              }
              break;
            }
          }
        }
        return valid;
      }

      _getDirectionConstraints() {
        // Prüft alle eingetragenen Buchstabenfelder darauf, ob es noch möglich ist,
        // ein Wort in der anderen Richtung zu platzieren. Ist dies nicht der Fall,
        // ist das aktuelle Grid ungültig.
        let that = this;
        let invalidFields = [];
        for (let y = 0; y < that.height; y++) {
          for (let x = 0; x < that.width; x++) {
            if (that.grid[y][x].isLetter) {
              let field = that.grid[y][x];
              let valid = false;
              let i, current, above, below, left, right;
              // Vertikales Wort fehlt
              // --> Ausgehend vom aktuellen Feld nach oben gehen und nach einem freien
              // Feld suchen, in welchem noch ein Wort platziert werden kann.
              // Wenn es in dieser Richtung nur eine Möglichkeit gibt, diese als verpflichtend
              // kennzeichnen.
              if (field.hasHorizontalWord && !field.hasVerticalWord) {
                for (i = 1; i < that.maxLength && y - i >= 0; i++) {
                  current = that.grid[y - i][x];
                  if (y - i > 0) {
                    above = that.grid[y - i - 1][x];
                  } else {
                    above = null;
                  }

                  if (current.isEmpty || current.isClue) {
                    valid = true;
                    break;
                  }
                  // Hinweisfeld (C) oder Rand erreicht, welches in andere Richtung zeigt. Dann
                  // die Felder links und rechts (X) vom aktuellen Feld checken.
                  // |   | C |   |
                  // | X | - | X |
                  // |   | - |   |
                  if ((above != null && above.isClue) || y - i == 0) {
                    if (x > 0) {
                      left = that.grid[y - i][x - 1];
                      if (left.isEmpty) {
                        valid = true;
                      }
                    }
                    if (x < that.width - 1) {
                      right = that.grid[y - i][x + 1];
                      if (right.isEmpty) {
                        valid = true;
                      }
                    }
                    break;
                  }
                }
              }
              // Horizontales Wort fehlt
              else if (field.hasVerticalWord && !field.hasHorizontalWord) {
                for (i = 1; i < that.maxLength && x - i >= 0; i++) {
                  current = that.grid[y][x - i];
                  if (x - i > 0) {
                    left = that.grid[y][x - i - 1];
                  } else {
                    left = null;
                  }

                  if (current.isEmpty || current.isClue) {
                    valid = true;
                    break;
                  }

                  if ((left != null && left.isClue) || x - i == 0) {
                    if (y > 0) {
                      above = that.grid[y - 1][x - i];
                      if (above.isEmpty) {
                        valid = true;
                      }
                    }
                    if (y < that.height - 1) {
                      below = that.grid[y + 1][x - i];
                      if (below.isEmpty) {
                        valid = true;
                      }
                    }
                    break;
                  }
                }
              } else {
                continue;
              }
              if (!valid) {
                invalidFields.push(field);
              }
            }
          }
        }

        return invalidFields;
      }

      _validateEdges() {
        // Es wird nach folgender Konstellation aus Hinweisfeldern (X) am oberen
        // Rand gesucht:
        // | X | - | X |
        // |   |   |   |
        // |   | X |   |
        // Bei dieser Konstellation ist das Feld mit dem '-' nicht mehr befüllbar
        // Am linken Rand wird nach der gleichen Konstellation um 90Grad gedreht gesucht

        let impossible = [];
        let first, second, third, below, left;
        for (let x = 0; x < this.width - 1; x++) {
          first = this.grid[0][x];
          second = this.grid[0][x + 1];
          third = this.grid[0][x + 2] || null;
          left = this.grid[1][x];
          below = this.grid[2][x + 1];

          if (
            first.isClueOrReserved &&
            ((third && third.isClueOrReserved) || third == null) &&
            below.isClueOrReserved &&
            second.isEmpty &&
            ((left.isClue &&
              left.clueFor &&
              left.clueFor.horizontal === true) ||
              !left.isClue)
          ) {
            impossible.push(second);
          }
        }

        for (let y = 0; y < this.height - 1; y++) {
          first = this.grid[y][0];
          second = this.grid[y + 1][0];
          third = this.grid[y + 2] ? this.grid[y + 2][0] : null;
          left = this.grid[y][1];
          below = this.grid[y + 1][2];

          if (
            first.isClueOrReserved &&
            ((third && third.isClueOrReserved) || third == null) &&
            below.isClueOrReserved &&
            second.isEmpty &&
            ((left.isClue &&
              left.clueFor &&
              left.clueFor.horizontal === false) ||
              !left.isClue)
          ) {
            impossible.push(second);
          }
        }
        return impossible;
      }

      getScore() {
        return this._calculateScore();
      }

      _calculateScore() {
        this._countFields();
        let score = 0;
        let totalFields = this.height * this.width;
        score += this.eval.finished * 3;
        score -= this.eval.partial;
        score *= this.eval.empty / totalFields;
        return parseFloat(score.toFixed(2));
      }

      _countFields() {
        let that = this;
        let empty = 0;
        let finished = 0;
        let partial = 0;
        for (let y = 0; y < that.height; y++) {
          for (let x = 0; x < that.width; x++) {
            let field = that.grid[y][x];
            if (field.isEmpty) {
              empty += 1;
              continue;
            }

            if (
              (field.hasHorizontalWord && field.hasVerticalWord) ||
              field.isClue
            ) {
              finished += 1;
              continue;
            }

            if (field.hasHorizontalWord || field.hasVerticalWord) {
              partial += 1;
            }
          }
        }
        this.eval.finished = finished;
        this.eval.partial = partial;
        this.eval.empty = empty;
      }

      getEvaluation(x, y) {
        return this.grid[y][x].score;
      }

      getDirectionEvaluation(direction, clueX, clueY) {
        // if (clueX === 0 || clueY === 0) {
        //   return 1;
        // }
        return this.controller
          .getView()
          .getModel("weights")
          .getProperty("/directions/" + direction);
      }

      getReservedFieldBonus(x, y, wordLength) {
        // Gibt einen Multiplier zurück, der größer 1 ist, wenn
        // das nächste Feld bereits als Hinweisfeld markiert ist oder
        // das Wort am Rand des Feldes endet
        if (x < this.width && y < this.height) {
          if (this.grid[y][x].isClue || this.grid[y][x].reserved) {
            return 1.2;
          }
          // if (this.grid[y][x].reserved) {
          // let averageWordLength = this.controller
          //   .getView()
          //   .getModel("settings")
          //   .getProperty("/averageWordLength");
          // let diff = Math.abs(wordLength - averageWordLength);
          //   return 1.2 - diff * 0.1;
          // }
        } else {
          return 1.3;
        }
        return 1;
      }

      getParallelWordScore(x, y, direction) {
        // Zählt die Anzahl Wörter, die links/rechts neben dem aktuellen
        // Wort liegen und auf dem Feld nebenan enden. Wenn 2 Wörter in die
        // gleiche Richtung verlaufen und auf der gleichen Höhe enden, entstehen
        // dadurch auch zwangsweise nebeneinanderliegende Hinweisefelder. Dadurch
        // wird die Struktur vom Rätsel schlechter und die Möglichkeiten für
        // neue Wörter eingeschränkt.

        // vertikales Wort --> Suche nach parallelen vertikalen Wörtern
        // Edit: nicht nach parallelen Wörtern suchen, sondern nach Hinweisfeldern neben dem Hinweisfeld
        // was hinter dem gegebenen Wort entsteht
        let adjWordEndings = 0;
        let parallelWordPenalty = this.controller
          .getView()
          .getModel("weights")
          .getProperty("/parallelWordPenalty");
        if (
          direction === "rightdown" ||
          direction === "leftdown" ||
          direction === "down"
        ) {
          if (y == this.height - 1) {
            // Am unteren Rand gibt es kein Feld darunter, das als "reserved"
            // markiert werden könnte. Stattdessen direkt prüfen, ob ein
            // Nachbarwort in gleicher Orientierung ebenfalls genau am Rand endet.
            if (x < this.width - 1) {
              let right = this.grid[y][x + 1];
              if (
                right.dummyVertical &&
                right.dummyVertical.startY + right.dummyVertical.length - 1 == y
              ) {
                adjWordEndings += 1;
              }
            }
            if (x > 0) {
              let left = this.grid[y][x - 1];
              if (
                left.dummyVertical &&
                left.dummyVertical.startY + left.dummyVertical.length - 1 == y
              ) {
                adjWordEndings += 1;
              }
            }
            return 1 - adjWordEndings * parallelWordPenalty;
          }
          // Feld rechts vom aktuellen Feld
          if (x < this.width - 1) {
            let right = this.grid[y][x + 1];
            if (
              right.dummyVertical &&
              right.dummyVertical.startY + right.dummyVertical.length - 1 == y
            ) {
              adjWordEndings += 1;
            }
            // let right = this.grid[y + 1][x + 1];
            // if (right.reserved) {
            //   adjWordEndings += 1;
            // }
          }
          // Feld links vom aktuellen Feld
          if (x > 0) {
            let left = this.grid[y][x - 1];
            if (
              left.dummyVertical &&
              left.dummyVertical.startY + left.dummyVertical.length - 1 == y
            ) {
              adjWordEndings += 1;
            }
            // let left = this.grid[y + 1][x - 1];
            // if (left.reserved) {
            //   adjWordEndings += 1;
            // }
          }
        }
        // horizontales Wort
        else {
          if (x == this.width - 1) {
            // Am rechten Rand gibt es kein Feld daneben, das als "reserved"
            // markiert werden könnte. Stattdessen direkt prüfen, ob ein
            // Nachbarwort in gleicher Orientierung ebenfalls genau am Rand endet.
            if (y < this.height - 1) {
              let below = this.grid[y + 1][x];
              if (
                below.dummyHorizontal &&
                below.dummyHorizontal.startX +
                  below.dummyHorizontal.length -
                  1 ==
                  x
              ) {
                adjWordEndings += 1;
              }
            }
            if (y > 0) {
              let above = this.grid[y - 1][x];
              if (
                above.dummyHorizontal &&
                above.dummyHorizontal.startX +
                  above.dummyHorizontal.length -
                  1 ==
                  x
              ) {
                adjWordEndings += 1;
              }
            }
            return 1 - adjWordEndings * parallelWordPenalty;
          }
          // Feld unter dem aktuellen Feld
          if (y < this.height - 1) {
            let below = this.grid[y + 1][x];
            if (
              below.dummyHorizontal &&
              below.dummyHorizontal.startX + below.dummyHorizontal.length - 1 ==
                x
            ) {
              adjWordEndings += 1;
            }
            // let below = this.grid[y + 1][x + 1];
            // if (below.reserved) {
            //   adjWordEndings += 1;
            // }
          }
          // Feld über dem aktuellen Feld
          if (y > 0) {
            let above = this.grid[y - 1][x];
            if (
              above.dummyHorizontal &&
              above.dummyHorizontal.startX + above.dummyHorizontal.length - 1 ==
                x
            ) {
              adjWordEndings += 1;
            }
            // let above = this.grid[y - 1][x];
            // if (above.reserved) {
            //   adjWordEndings += 1;
            // }
          }
        }
        return 1 - adjWordEndings * parallelWordPenalty;
      }

      getLengthBonus(length) {
        let bonus = this.controller
          .getView()
          .getModel("weights")
          .getProperty(`/lengthBonus/${length}`);

        let averageWordLength = this.controller
          .getView()
          .getModel("settings")
          .getProperty("/averageWordLength");

        let currentWordLength = this._getCurrentAverageWordLength() || 0;
        if (currentWordLength === 0) {
          return 1;
        }

        let bonusLong, bonusShort;

        bonusLong = averageWordLength / currentWordLength;
        bonusShort = currentWordLength / averageWordLength;

        if (length <= averageWordLength) {
          return bonus * bonusShort;
        } else {
          return bonus * bonusLong;
        }
      }

      _getCurrentAverageWordLength() {
        let totalLength = 0;
        for (let i = 0; i < this.dummys.length; i++) {
          totalLength += this.dummys[i].length;
        }
        return totalLength / this.dummys.length;
      }

      _evaluateGrid() {
        let that = this;
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            let edges = that._getAdjEdges(field);
            let clues = that._getAdjClues(field);
            let blocked = that._getAdjBlocked(field);
            let letters = that._getAdjLetters(field);
            let score = 0;

            score += letters * 0.2;
            if (!field.isClue) {
              score += clues * 0.4;
            }
            if (field.nextWordLocation) {
              score += 1;
            }
            score += edges * 0.5;
            score += (that.width - field.x) * 0.1;
            score += (that.height - field.y) * 0.1;
            score = parseFloat(score.toFixed(2));

            field.edges = edges;
            field.clues = clues;
            field.blocked = blocked;
            field.letters = letters;
            field.score = score;
          });
        });
      }

      getDiagonalClueBonus(field) {
        // Wenn diagonal hinter dem letzten Buchstabenfeld Hinweisfelder liegen,
        // entstehen gute Lücken für Kreuzungen
        let bonus = 0;
        let x = field.x;
        let y = field.y;
        // Topleft
        if (x > 0 && y > 0) {
          let topleft = this.grid[y - 1][x - 1];
          if (topleft.x != field.startX && topleft.y != field.startY) {
            if (topleft.reserved) {
              bonus += 2;
            } else if (topleft.nextWordLocation) {
              bonus += 1;
            }
          }
        }
        if (field.horizontal) {
          // Bottomleft
          if (y < this.height - 1 && x > 0) {
            let bottomleft = this.grid[y + 1][x - 1];
            if (bottomleft.x != field.startX && bottomleft.y != field.startY) {
              if (bottomleft.reserved) {
                bonus += 1;
              } else if (bottomleft.nextWordLocation) {
                bonus += 0.5;
              }
            }
          }
        } else {
          // Topright
          if (x < this.width - 1 && y > 0) {
            let topright = this.grid[y - 1][x + 1];
            if (topright.x != field.startX && topright.y != field.startY) {
              if (topright.reserved) {
                bonus += 1;
              } else if (topright.nextWordLocation) {
                bonus += 0.5;
              }
            }
          }
        }

        return bonus;
      }

      _getAdjEdges(field) {
        let edges = 0;
        if (field.x == 0 || field.x == this.width - 1) {
          edges += 1;
        }
        if (field.y == 0 || field.y == this.height - 1) {
          edges += 1;
        }
        return edges;
      }

      // Prüfen, ob links/recht/oberhalb/unterhalb des aktuellen Feldes ein
      // angrenzendes Hinweisfeld von bestehenden Wörtern liegt.
      _getAdjClues(field) {
        return field.getAdjacentFields().filter((f) => f.isClue).length;
      }

      _getAdjBlocked(field) {
        return field.getAdjacentFields().filter((f) => f.isClueOrReserved)
          .length;
      }

      // Prüfen, ob links/recht/oberhalb/unterhalb des aktuellen Feldes ein
      // angrenzender Buchstabe von bestehenden Wörtern liegt.
      _getAdjLetters(field) {
        return field.getAdjacentFields().filter((f) => f.isLetter).length;
      }

      _getForcedDummyLocations() {
        let that = this;
        let locations = [];
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (field.nextWordLocation && field.isEmpty && field.reserved) {
              locations.push({
                field: field,
                score: that.getEvaluation(field.x, field.y),
              });
            }
          });
        });
        locations.sort(function (a, b) {
          return b.score - a.score;
        });
        return locations.map(function (location) {
          return location.field;
        });
      }

      _getOptionalDummyLocations() {
        let that = this;
        let locations = [];
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (field.nextWordLocation && field.isEmpty && !field.reserved) {
              locations.push(field);
            }
          });
        });
        return locations;
      }

      resetGrid() {
        this.grid = [];
        for (let y = 0; y < this.height; y++) {
          this.grid.push([]);
          let row = this.grid[y];
          for (let x = 0; x < this.width; x++) {
            row[x] = new Field(x, y, this);
          }
        }
        this._evaluateGrid();
      }

      getGrid() {
        return this.grid;
      }

      getMaxLength() {
        return this.maxLength || 0;
      }

      getArrowPositions() {
        let arrows = [];
        this.dummys.forEach(function (dummy) {
          if (dummy.shaped) {
            arrows.push({
              x: dummy.startX,
              y: dummy.startY,
              direction: dummy.direction,
            });
          }
        });
        // TODO
        // Check, ob an einem Feld 2 Wörter vertikal + horizontal anfangen
        // dafür dann CSS anpassen mit Doppelpfeil
        return arrows;
      }

      _shapeFirstDummy() {
        let settings = this.controller.getView().getModel("settings");
        let x = settings.getProperty("/firstWordX");
        let y = settings.getProperty("/firstWordY");

        let length = settings.getProperty("/firstWordLength");
        let direction = settings.getProperty("/firstWordDirection");

        let maxStartY = settings.getProperty("/height") - 5;
        let maxStartX = settings.getProperty("/width") - 5;

        maxStartX = maxStartX < 0 ? 0 : maxStartX;
        maxStartY = maxStartY < 0 ? 0 : maxStartY;

        x = x > maxStartX ? maxStartX : x;
        y = y > maxStartY ? maxStartY : y;

        // Maximal mögliche Länge ausgehend vom Hinweisfeld (x/y) in die
        // gegebene Richtung bis zum Rand des Grids
        let maxFittingLength;
        switch (direction) {
          case "right":
            maxFittingLength = this.width - (x + 1);
            break;
          case "rightdown":
          case "leftdown":
            maxFittingLength = this.height - y;
            break;
          case "down":
            maxFittingLength = this.height - (y + 1);
            break;
          case "downright":
          case "upright":
            maxFittingLength = this.width - x;
            break;
        }
        length = length > maxFittingLength ? maxFittingLength : length;

        let dummy = new Dummy(x, y, this);
        dummy.shape(false, direction, length);
        // Gewünschte Form ist nicht möglich (z.B. Richtung an dieser Position nicht
        // erlaubt) - dann die beste verfügbare Möglichkeit nehmen
        if (!dummy.shaped) {
          dummy.shape();
        }
      }

      getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      removeLastWord() {
        this.removeDummyFromGrid(this.dummys[this.dummys.length - 1]);
        this.updateGrid();
      }

      updateGrid() {
        this._evaluateGrid();
        this.controller.setGrid(this.getGrid());
        // this.controller.resetArrows();
        this.controller.addArrows();
      }

      addDummyToGrid(dummy) {
        this.dummys.push(dummy);
        this._addDummyLetters(dummy);
        this._markForcedWordLocations(dummy);
        this._markOptionalWordLocations(dummy);
        this._evaluateGrid();
        this._markStructuralForcedFields();
        // console.log("Added ", dummy);
      }

      _addDummyLetters(dummy) {
        this.grid[dummy.y][dummy.x].setClue(dummy);

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          let field = this.grid[y][x];

          field.setLetter(dummy);
          if (dummy.horizontal) {
            // if (
            //   that.grid[y - 1] &&
            //   that.grid[y - 1][x].isClue &&
            //   that.grid[y + 1] &&
            //   that.grid[y + 1][x].isEmpty
            // ) {
            //   that.grid[y + 1][x].mark(dummy, { forced: true });
            // }
          } else {
            // if (
            //   that.grid[y][x - 1] &&
            //   that.grid[y][x - 1].isClue &&
            //   that.grid[y][x + 1] &&
            //   that.grid[y][x + 1].isEmpty
            // ) {
            //   that.grid[y][x + 1].mark(dummy, { forced: true });
            // }
          }
        }
      }

      _markForcedWordLocations(dummy) {
        // Visualization in the comments:
        //    C: Clue Field; if no clue field is given, the position is not important and can be ignored
        //    WORD: current dummy word in <horizontal> orientation and its
        //          placement compared to the clue field
        //    #: Location that gets marked as a possible location for the next word

        // Vocuabulary:
        //    marker: Describes a field, that is marked as a possible location for the next word. If in a
        //            certain position, there has to be a clue/word placed in that spot, indicated by <reserved>
        let that = this;
        if (dummy.horizontal) {
          // Word and clue not in a straight line, marker 2 fields next to the clue as a possible location
          if (dummy.y != dummy.startY) {
            // |#| | | |
            // |W|O|R|D|
            // |C| | | |
            if (dummy.y > dummy.startY) {
              if (
                that.grid[dummy.y - 2] &&
                that.grid[dummy.y - 2][dummy.x].isEmpty
              ) {
                that.grid[dummy.y - 2][dummy.x].mark(dummy, { forced: true });
              }
            } else {
              // |C| | | |
              // |W|O|R|D|
              // |#| | | |
              if (
                that.grid[dummy.y + 2] &&
                that.grid[dummy.y + 2][dummy.x].isEmpty
              ) {
                // experimentell TODO:evtl. forced: false setzen
                that.grid[dummy.y + 2][dummy.x].mark(dummy, { forced: true });
              }
            }
          }

          if (that.grid[dummy.startY][dummy.startX + dummy.length]) {
            // Field behind the word is always a marker
            // | | | | | |
            // |W|O|R|D|#|
            // | | | | | |
            that.grid[dummy.startY][dummy.startX + dummy.length].mark(dummy, {
              forced: true,
            });
            if (
              dummy.startY == 1 &&
              that.grid[0][dummy.startX + dummy.length].isEmpty
            ) {
              // The word is placed in the second row. A marker has to be behind the word ('+').
              // At the top of the grid in the first row, no words are allowed that go parallel to the border.
              // If the field above the marker stays free, an empty field would occur since no word can be placed there.
              // It is marked as well.
              //  _________
              // | | | | |#|
              // |W|O|R|D|+|
              // | | | | | |
              that.grid[0][dummy.startX + dummy.length].mark(dummy, {
                forced: true,
              });
            }
          }
          if (that.grid[dummy.startY][dummy.startX - 1]) {
            // | | | | | |
            // |#|W|O|R|D|
            // | | | | | |

            // Feld vor dem Wort als Pflichtfeld markieren, wenn das Hinweisfeld darüber/darunter in
            // der Zeile liegt
            if (dummy.startY != dummy.y) {
              that.grid[dummy.startY][dummy.startX - 1].mark(dummy, {
                forced: true,
              });
            }

            if (dummy.startY == 1 && that.grid[0][dummy.startX - 1].isEmpty) {
              // The word is placed in the second row. A marker has to be in front of the word ('+').
              // At the top of the grid in the first row, no words are allowed that go parallel to the border.
              // If the field above the marker stays free, an empty field would occur since no word can be placed there.
              // It is marked as well.
              //  _________
              // |#| | | | |
              // |+|W|O|R|D|
              // | | | | | |
              that.grid[0][dummy.startX - 1].mark(dummy, { forced: true });
            }
          }

          if (dummy.direction === "right") {
            if (
              that.grid[dummy.y + 1] &&
              that.grid[dummy.y + 1][dummy.x].isLetter
            ) {
              if (
                that.grid[dummy.y + 2] &&
                that.grid[dummy.y + 2][dummy.x].isEmpty
              ) {
                that.grid[dummy.y + 2][dummy.x].mark(dummy, { forced: true });
              }
            }
          }
        }

        // VERTICAL
        else {
          // The word is placed vertically, the logic is the same as above but adjusted to the new orientation
          if (dummy.x != dummy.startX) {
            if (dummy.x > dummy.startX) {
              if (
                that.grid[dummy.y][dummy.x - 2] &&
                that.grid[dummy.y][dummy.x - 2].isEmpty
              ) {
                that.grid[dummy.y][dummy.x - 2].mark(dummy, { forced: true });
              }
            } else {
              if (
                that.grid[dummy.y][dummy.x + 2] &&
                that.grid[dummy.y][dummy.x + 2].isEmpty
              ) {
                // experimentell TODO:evtl. forced: false setzen
                that.grid[dummy.y][dummy.x + 2].mark(dummy, { forced: true });
              }
            }
          }
          if (that.grid[dummy.startY + dummy.length]) {
            that.grid[dummy.startY + dummy.length][dummy.startX].mark(dummy, {
              forced: true,
            });
            if (
              dummy.startX == 1 &&
              that.grid[dummy.startY + dummy.length][0].isEmpty
            ) {
              that.grid[dummy.startY + dummy.length][0].mark(dummy, {
                forced: true,
              });
            }
          }

          if (that.grid[dummy.startY - 1]) {
            if (dummy.startX != dummy.x) {
              that.grid[dummy.startY - 1][dummy.startX].mark(dummy, {
                forced: true,
              });
            }

            if (dummy.startX == 1 && that.grid[dummy.startY - 1][0].isEmpty) {
              that.grid[dummy.startY - 1][0].mark(dummy, { forced: true });
            }
          }

          if (dummy.direction === "down") {
            if (
              that.grid[dummy.y][dummy.x + 1] &&
              that.grid[dummy.y][dummy.x + 1].isLetter
            ) {
              if (
                that.grid[dummy.y][dummy.x + 2] &&
                that.grid[dummy.y][dummy.x + 2].isEmpty
              ) {
                that.grid[dummy.y][dummy.x + 2].mark(dummy, { forced: true });
              }
            }
          }
        }
      }

      _markOptionalWordLocations(dummy) {
        let that = this;
        let x = dummy.startX;
        let y = dummy.startY;

        // Optional, experimental locations 2 fields away from the current clue field:
        // |W|O|R|D|        |C| |#| |
        // |C| |#| |        |W|O|R|D|
        if (dummy.horizontal) {
          if (
            that.grid[dummy.y][dummy.x + 2] &&
            that.grid[dummy.y][dummy.x + 2].isEmpty
          ) {
            that.grid[dummy.y][dummy.x + 2].mark(dummy, { forced: false });
          }
        } else {
          if (
            that.grid[dummy.y + 2] &&
            that.grid[dummy.y + 2][dummy.x] &&
            that.grid[dummy.y + 2][dummy.x].isEmpty
          ) {
            that.grid[dummy.y + 2][dummy.x].mark(dummy, { forced: false });
          }
        }

        for (let offset = 0; offset < dummy.length; offset++) {
          // iterate over each field of the word by adjusting the coordinates
          // according to the orientation of the word

          // if the word is horizontal, mark the fartest field above
          // the current letter as a possible location for the next word
          if (dummy.horizontal) {
            x = dummy.startX + offset;
            let minY = -1;
            for (let i = y - 1; i >= 0; i--) {
              if (
                !that.grid[i][x].reserved &&
                (that.grid[i][x].isEmpty || that.grid[i][x].isLetter)
              ) {
                minY = i;
              } else {
                break;
              }
            }
            if (minY >= 0 && that.grid[minY][x].isEmpty) {
              that.grid[minY][x].mark(dummy, { forced: false });
            }
          }
          // if the word is vertical, mark the fartest field to the left of
          // the current letter as a possible location for the next word
          else {
            y = dummy.startY + offset;
            let minX = -1;
            for (let i = x - 1; i >= 0; i--) {
              if (
                !that.grid[y][i].reserved &&
                (that.grid[y][i].isEmpty || that.grid[y][i].isLetter)
              ) {
                minX = i;
              } else {
                break;
              }
            }
            if (minX >= 0 && that.grid[y][minX].isEmpty) {
              that.grid[y][minX].mark(dummy, { forced: false });
            }
          }
        }
      }

      removeDummyFromGrid(dummy) {
        this._removeDummyLetters(dummy);
        this._unmarkNextWordLocations(dummy);
        if (this.dummys.indexOf(dummy) != -1) {
          this.dummys.splice(this.dummys.indexOf(dummy), 1);
        }
        this._evaluateGrid();
        this._markStructuralForcedFields();
        console.log("Removed ", dummy);
      }

      _removeDummyLetters(dummy) {
        // clue field
        this.grid[dummy.y][dummy.x].removeClue();

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          this.grid[y][x].removeLetter(dummy);
        }
      }

      _unmarkNextWordLocations(dummy) {
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            field.unmark(dummy);
          });
        });
      }

      highlight(x, y) {
        this._setFocusedCell(x, y);

        this.controller.setGrid(this.getGrid());
      }

      hideCurrentWord() {
        this.highlightedWord = null;
        this.highlightedCells = [];
        if (this.focusedCell != null) {
          this.grid[this.focusedCell.y][this.focusedCell.x].focused = false;
          this.focusedCell = null;
        }
      }

      _setFocusedCell(x, y) {
        if (this.focusedCell != null) {
          this.grid[this.focusedCell.y][this.focusedCell.x].focused = false;
        }
        this.grid[y][x].focused = true;
        this.focusedCell = { x: x, y: y };
      }
    };
  },
);
