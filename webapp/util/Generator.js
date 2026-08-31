sap.ui.define(
  ["sap/ui/model/json/JSONModel", "kreuzwort/kreuzwort/util/Dummy"],
  function (JSONModel, Dummy) {
    "use strict";

    return class Generator {
      constructor(controllerRef) {
        this.controller = controllerRef;
        this.grid = [];
        this.gridEvaluation = [];
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

      getField(x, y) {
        if (x < this.width && y < this.height) {
          return this.grid[y][x];
        }
      }

      getLastDummy() {
        return this.dummys[this.dummys.length - 1];
      }

      // ---- Zentrale Feld-State-Verwaltung ----
      // isEmpty/isLetter/isClue/hasHorizontalWord/hasVerticalWord sind aus
      // clueFor/dummyHorizontal/dummyVertical abgeleitet. reserved/nextWordLocation
      // sind aus forcedBy/markedBy abgeleitet. Beides wird ausschließlich über die
      // folgenden Funktionen geschrieben, damit die Flags nie auseinanderlaufen
      // können (siehe forcedBy/markedBy als "wer hält diesen Marker gerade").

      _recomputeContentFlags(field) {
        field.isClue = field.clueFor !== null;
        field.isLetter =
          field.dummyHorizontal !== null || field.dummyVertical !== null;
        field.isEmpty = !field.isClue && !field.isLetter;
        field.hasHorizontalWord = field.dummyHorizontal !== null;
        field.hasVerticalWord = field.dummyVertical !== null;
      }

      _recomputeMarkers(field) {
        field.reserved = field.forcedBy.size > 0;
        field.nextWordLocation =
          field.forcedBy.size > 0 || field.markedBy.size > 0;
      }

      // owner: der Dummy, der für diesen Marker verantwortlich ist. Wird der
      // Dummy später entfernt/umgeformt, wird der Marker über _unmarkField
      // wieder zurückgenommen. Für Marker, die aus der Grid-Struktur selbst
      // entstehen (nicht an einen einzelnen Dummy gebunden), wird
      // this._structuralForceKey als owner verwendet.
      _markField(field, owner, { forced = false } = {}) {
        if (forced) {
          field.forcedBy.add(owner);
        } else {
          field.markedBy.add(owner);
        }
        this._recomputeMarkers(field);
      }

      _unmarkField(field, owner) {
        field.forcedBy.delete(owner);
        field.markedBy.delete(owner);
        this._recomputeMarkers(field);
      }

      // true, wenn das Feld durch etwas anderes als die strukturelle Ableitung
      // selbst reserviert ist (also durch einen echten, platzierten Dummy).
      // Nur in diesem Fall ist die Position wirklich "extern" schon geklärt.
      // Ist ein Feld ausschließlich über structuralForceKey reserviert, soll
      // es bei jeder Neuermittlung weiterhin als offener Kandidat gelten,
      // damit _getForcedFields()/_getEncasedFields() bei jedem Aufruf den
      // vollständigen, aktuell korrekten Stand liefern (nicht nur neu
      // hinzugekommene Fälle) und sich so für einen Abgleich eignen.
      _isReservedByOther(field) {
        for (const owner of field.forcedBy) {
          if (owner !== this._structuralForceKey) {
            return true;
          }
        }
        return false;
      }

      step() {
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
            let objA = { x: a.x, y: a.y };
            let objB = { x: b.x, y: b.y };

            let adjClueDiff = that._getAdjClues(objA) - that._getAdjClues(objB);
            if (adjClueDiff !== 0) {
              return adjClueDiff;
            }

            return that.getEvaluation(b.x, b.y) - that.getEvaluation(a.x, a.y);
          });
          location = optionalLocations[0];
        } else {
          console.log("NO MARKED LOCATIONS LEFT");
          for (let y = 0; y < that.height; y++) {
            for (let x = 0; x < that.width; x++) {
              if (that.grid[y][x].isEmpty) {
                that._markField(that.grid[y][x], that._structuralForceKey, {
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
        // TODO TODO TODO
        impossibleEdges.forEach(function (f) {
          // Oberer Rand
          if (f.y === 0) {
            left = that.grid[f.y][f.x - 1].clueFor || null;
            right = that.grid[f.y][f.x + 1].clueFor || null;
            below = that.grid[f.y + 2][f.x].clueFor || null;

            if (
              left &&
              left.direction === "down" &&
              left.length < that.maxLength &&
              that.grid[f.y][f.x - 2] &&
              that.grid[f.y][f.x - 2].reserved
            ) {
              fixes.push({ field: f, replace: left, direction: "leftdown" });
            } else if (
              right &&
              right.direction === "down" &&
              right.length < that.maxLength &&
              that.grid[f.y][f.x + 2] &&
              that.grid[f.y][f.x + 2].reserved
            ) {
              fixes.push({ field: f, replace: right, direction: "rightdown" });
            } else {
              possible = false;
            }
          }
          // Linker Rand
          else {
            above = that.grid[f.y - 1][f.x].clueFor || null;
            below = that.grid[f.y + 1][f.x].clueFor || null;
            right = that.grid[f.y][f.x + 2].clueFor || null;
            if (
              above &&
              above.direction === "right" &&
              above.length < that.maxLength &&
              that.grid[f.y - 2] &&
              that.grid[f.y - 2][f.x].reserved
            ) {
              fixes.push({ field: f, replace: above, direction: "upright" });
            } else if (
              below &&
              below.direction === "right" &&
              below.length < that.maxLength &&
              that.grid[f.y + 2] &&
              that.grid[f.y + 2][f.x].reserved
            ) {
              fixes.push({ field: f, replace: below, direction: "downright" });
            } else {
              possible = false;
            }
          }
        });

        if (possible) {
          fixes.forEach(function (fix) {
            that.removeDummyFromGrid(fix.replace);
            let newDummy = new Dummy(fix.field.x, fix.field.y, that);
            newDummy.shape(false, fix.direction, fix.replace.length + 1);
          });
          return true;
        }
        return false;
      }

      _getBlockedFields() {
        let that = this;
        let blocked = [];
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (!field.isEmpty) {
              return;
            }
            let evaluation = that.gridEvaluation[field.y][field.x];
            if (evaluation.edges + evaluation.blocked === 4) {
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

        forcedFields = forcedFields.concat(encasedFields, oppositeForcedFields);
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
              that._unmarkField(field, that._structuralForceKey);
            }
          });
        });

        forcedFields.forEach(function (field) {
          that._markField(field, that._structuralForceKey, { forced: true });
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
        let that = this;
        let encased = [];

        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            if (!field.isEmpty) {
              return;
            }
            // count adjacent edges/clue fields
            let evaluation = that.gridEvaluation[field.y][field.x];
            if (evaluation.edges + evaluation.clues !== 3) {
              return;
            }

            let below =
              field.y < that.height - 1
                ? that.grid[field.y + 1][field.x]
                : null;
            let right =
              field.x < that.width - 1 ? that.grid[field.y][field.x + 1] : null;

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

      _getClueClump(field, clueFields, visited) {
        if (!visited) {
          visited = new Set();
        }

        let key = field.x + "," + field.y;
        if (visited.has(key)) {
          return clueFields;
        }

        visited.add(key);
        clueFields.push(field);
        // Feld links
        if (field.x > 0) {
          if (
            this.grid[field.y][field.x - 1].isClue ||
            this.grid[field.y][field.x - 1].reserved
          ) {
            clueFields = this._getClueClump(
              this.grid[field.y][field.x - 1],
              clueFields,
              visited,
            );
          }
          // Feld linksoben
          if (field.y > 0) {
            if (
              this.grid[field.y - 1][field.x - 1].isClue ||
              this.grid[field.y - 1][field.x - 1].reserved
            ) {
              clueFields = this._getClueClump(
                this.grid[field.y - 1][field.x - 1],
                clueFields,
                visited,
              );
            }
          }
        }
        // Feld oben
        if (field.y > 0) {
          if (
            this.grid[field.y - 1][field.x].isClue ||
            this.grid[field.y - 1][field.x].reserved
          ) {
            clueFields = this._getClueClump(
              this.grid[field.y - 1][field.x],
              clueFields,
              visited,
            );
          }
          // Feld rechtsoben
          if (field.x < this.width - 1) {
            if (
              this.grid[field.y - 1][field.x + 1].isClue ||
              this.grid[field.y - 1][field.x + 1].reserved
            ) {
              clueFields = this._getClueClump(
                this.grid[field.y - 1][field.x + 1],
                clueFields,
                visited,
              );
            }
          }
        }

        // Feld rechts
        if (field.x < this.width - 1) {
          if (
            this.grid[field.y][field.x + 1].isClue ||
            this.grid[field.y][field.x + 1].reserved
          ) {
            clueFields = this._getClueClump(
              this.grid[field.y][field.x + 1],
              clueFields,
              visited,
            );
          }

          // Feld rechtsunten
          if (field.y < this.height - 1) {
            if (
              this.grid[field.y + 1][field.x + 1].isClue ||
              this.grid[field.y + 1][field.x + 1].reserved
            ) {
              clueFields = this._getClueClump(
                this.grid[field.y + 1][field.x + 1],
                clueFields,
                visited,
              );
            }
          }
        }

        // Feld unten
        if (field.y < this.height - 1) {
          if (
            this.grid[field.y + 1][field.x].isClue ||
            this.grid[field.y + 1][field.x].reserved
          ) {
            clueFields = this._getClueClump(
              this.grid[field.y + 1][field.x],
              clueFields,
              visited,
            );
          }

          // Feld linksunten
          if (field.x > 0) {
            if (
              this.grid[field.y + 1][field.x - 1].isClue ||
              this.grid[field.y + 1][field.x - 1].reserved
            ) {
              clueFields = this._getClueClump(
                this.grid[field.y + 1][field.x - 1],
                clueFields,
                visited,
              );
            }
          }
        }

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
            first.reserved &&
            ((third && third.reserved) || third == null) &&
            below.reserved &&
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
            first.isClue &&
            ((third && third.isClue) || third == null) &&
            below.isClue &&
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
        return this.gridEvaluation[y][x].score;
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

            if (!that.gridEvaluation[field.y]) {
              that.gridEvaluation[field.y] = [];
            }
            that.gridEvaluation[field.y][field.x] = {
              edges: edges,
              clues: clues,
              blocked: blocked,
              letters: letters,
              score: score,
            };

            that.grid[field.y][field.x].score = score;
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

      _getAdjClues(field) {
        let clues = 0;
        let x = field.x;
        let y = field.y;
        // Prüfen, ob links/recht/oberhalb/unterhalb des
        // aktuellen Feldes ein angrenzendes Hinweisfeld von
        // bestehenden Wörtern liegt.
        if (x > 0) {
          let left = this.grid[y][x - 1];
          if (left && !left.isEmpty && left.isClue) {
            clues += 1;
          }
        }

        if (x < this.width - 1) {
          let right = this.grid[y][x + 1];
          if (right && !right.isEmpty && right.isClue) {
            clues += 1;
          }
        }

        if (y > 0) {
          let above = this.grid[y - 1][x];
          if (above && !above.isEmpty && above.isClue) {
            clues += 1;
          }
        }

        if (y < this.height - 1) {
          let below = this.grid[y + 1][x];
          if (below && !below.isEmpty && below.isClue) {
            clues += 1;
          }
        }

        return clues;
      }

      _getAdjBlocked(field) {
        let blocked = 0;
        let x = field.x;
        let y = field.y;

        if (x > 0) {
          let left = this.grid[y][x - 1];
          if (left && (left.isClue || left.reserved)) {
            blocked += 1;
          }
        }

        if (x < this.width - 1) {
          let right = this.grid[y][x + 1];
          if (right && (right.isClue || right.reserved)) {
            blocked += 1;
          }
        }

        if (y > 0) {
          let above = this.grid[y - 1][x];
          if (above && (above.isClue || above.reserved)) {
            blocked += 1;
          }
        }

        if (y < this.height - 1) {
          let below = this.grid[y + 1][x];
          if (below && (below.isClue || below.reserved)) {
            blocked += 1;
          }
        }

        return blocked;
      }

      _getAdjLetters(field) {
        let letters = 0;
        let x = field.x;
        let y = field.y;
        // Prüfen, ob links/recht/oberhalb/unterhalb des
        // aktuellen Feldes ein angrenzender Buchstabe von
        // bestehenden Wörtern liegt.
        if (x > 0) {
          let left = this.grid[y][x - 1];
          if (left && !left.isEmpty && left.isLetter) {
            letters += 1;
          }
        }

        if (x < this.width - 1) {
          let right = this.grid[y][x + 1];
          if (right && !right.isEmpty && right.isLetter) {
            letters += 1;
          }
        }

        if (y > 0) {
          let above = this.grid[y - 1][x];
          if (above && !above.isEmpty && above.isLetter) {
            letters += 1;
          }
        }

        if (y < this.height - 1) {
          let below = this.grid[y + 1][x];
          if (below && !below.isEmpty && below.isLetter) {
            letters += 1;
          }
        }

        return letters;
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
            row[x] = {
              x: x,
              y: y,
              isEmpty: true,
              isLetter: false,
              isClue: false,
              score: 0,
              clueFor: null,
              dummyHorizontal: null,
              dummyVertical: null,
              forcedBy: new Set(),
              markedBy: new Set(),
              nextWordLocation: false,
              reserved: false,
              hasVerticalWord: false,
              hasHorizontalWord: false,
              highlighted: false,
              focused: false,
            };
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

        let dummy = new Dummy(x, y, this);
        dummy.shape(false, direction, length);
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
        let that = this;
        let clueField = this.grid[dummy.y][dummy.x];
        clueField.clueFor = dummy;
        this._recomputeContentFlags(clueField);

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          let field = this.grid[y][x];

          if (dummy.horizontal) {
            field.dummyHorizontal = dummy;
            this._recomputeContentFlags(field);
            // if (
            //   that.grid[y - 1] &&
            //   that.grid[y - 1][x].isClue &&
            //   that.grid[y + 1] &&
            //   that.grid[y + 1][x].isEmpty
            // ) {
            //   that._markField(that.grid[y + 1][x], dummy, { forced: true });
            // }
          } else {
            field.dummyVertical = dummy;
            this._recomputeContentFlags(field);
            // if (
            //   that.grid[y][x - 1] &&
            //   that.grid[y][x - 1].isClue &&
            //   that.grid[y][x + 1] &&
            //   that.grid[y][x + 1].isEmpty
            // ) {
            //   that._markField(that.grid[y][x + 1], dummy, { forced: true });
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
                that._markField(that.grid[dummy.y - 2][dummy.x], dummy, {
                  forced: true,
                });
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
                that._markField(that.grid[dummy.y + 2][dummy.x], dummy, {
                  forced: true,
                });
              }
            }
          }

          if (that.grid[dummy.startY][dummy.startX + dummy.length]) {
            // Field behind the word is always a marker
            // | | | | | |
            // |W|O|R|D|#|
            // | | | | | |
            that._markField(
              that.grid[dummy.startY][dummy.startX + dummy.length],
              dummy,
              { forced: true },
            );
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
              that._markField(
                that.grid[0][dummy.startX + dummy.length],
                dummy,
                { forced: true },
              );
            }
          }
          if (that.grid[dummy.startY][dummy.startX - 1]) {
            // | | | | | |
            // |#|W|O|R|D|
            // | | | | | |

            // Feld vor dem Wort als Pflichtfeld markieren, wenn das Hinweisfeld darüber/darunter in
            // der Zeile liegt
            if (dummy.startY != dummy.y) {
              that._markField(
                that.grid[dummy.startY][dummy.startX - 1],
                dummy,
                { forced: true },
              );
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
              that._markField(that.grid[0][dummy.startX - 1], dummy, {
                forced: true,
              });
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
                that._markField(that.grid[dummy.y + 2][dummy.x], dummy, {
                  forced: true,
                });
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
                that._markField(that.grid[dummy.y][dummy.x - 2], dummy, {
                  forced: true,
                });
              }
            } else {
              if (
                that.grid[dummy.y][dummy.x + 2] &&
                that.grid[dummy.y][dummy.x + 2].isEmpty
              ) {
                // experimentell TODO:evtl. forced: false setzen
                that._markField(that.grid[dummy.y][dummy.x + 2], dummy, {
                  forced: true,
                });
              }
            }
          }
          if (that.grid[dummy.startY + dummy.length]) {
            that._markField(
              that.grid[dummy.startY + dummy.length][dummy.startX],
              dummy,
              { forced: true },
            );
            if (
              dummy.startX == 1 &&
              that.grid[dummy.startY + dummy.length][0].isEmpty
            ) {
              that._markField(
                that.grid[dummy.startY + dummy.length][0],
                dummy,
                { forced: true },
              );
            }
          }

          if (that.grid[dummy.startY - 1]) {
            if (dummy.startX != dummy.x) {
              that._markField(
                that.grid[dummy.startY - 1][dummy.startX],
                dummy,
                { forced: true },
              );
            }

            if (dummy.startX == 1 && that.grid[dummy.startY - 1][0].isEmpty) {
              that._markField(that.grid[dummy.startY - 1][0], dummy, {
                forced: true,
              });
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
                that._markField(that.grid[dummy.y][dummy.x + 2], dummy, {
                  forced: true,
                });
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
            that._markField(that.grid[dummy.y][dummy.x + 2], dummy, {
              forced: false,
            });
          }
        } else {
          if (
            that.grid[dummy.y + 2] &&
            that.grid[dummy.y + 2][dummy.x] &&
            that.grid[dummy.y + 2][dummy.x].isEmpty
          ) {
            that._markField(that.grid[dummy.y + 2][dummy.x], dummy, {
              forced: false,
            });
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
              that._markField(that.grid[minY][x], dummy, { forced: false });
              if (x == 1 && that.grid[minY][0].isEmpty) {
                that._markField(that.grid[minY][0], dummy, { forced: true });
              }
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
              that._markField(that.grid[y][minX], dummy, { forced: false });
              if (y == 1 && that.grid[0][minX].isEmpty) {
                that._markField(that.grid[0][minX], dummy, { forced: true });
              }
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
        let clueField = this.grid[dummy.y][dummy.x];
        clueField.clueFor = null;
        this._recomputeContentFlags(clueField);

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          let field = this.grid[y][x];

          if (dummy.horizontal) {
            field.dummyHorizontal = null;
          } else {
            field.dummyVertical = null;
          }
          this._recomputeContentFlags(field);
        }
      }

      _unmarkNextWordLocations(dummy) {
        let that = this;
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            that._unmarkField(field, dummy);
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
