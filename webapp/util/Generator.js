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
        this.stepCount = 0;
      }

      init() {
        let settings = this.controller.getView().getModel("settings");
        this.height = settings.getProperty("/height");
        this.width = settings.getProperty("/width");
        this.maxLength = settings.getProperty("/maxWordLength");
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
        this.stepCount = 0;
        this.refreshSettings();
        this.resetGrid();
        this._shapeFirstDummy();
        this._getCurrentAverageWordLength();
        this.controller.setGrid(this.getGrid());
      }

      refreshSettings() {
        let settings = this.controller.getView().getModel("settings");
        this.height = settings.getProperty("/height");
        this.width = settings.getProperty("/width");
        this.maxLength = settings.getProperty("/maxWordLength");
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

      // In der 2x2-Ecke unten rechts dürfen keine Hinweisfelder liegen: für
      // die Felder dort könnten meist keine Wörter mehr gebildet werden.
      isClueForbidden(x, y) {
        return x >= this.width - 2 && y >= this.height - 2;
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

      // Grid ist fertig, wenn kein Feld mehr leer ist UND jedes Buchstabenfeld
      // horizontal und vertikal von einem Wort gekreuzt wird - außer die
      // fehlende Richtung ist an dieser Stelle blockiert. Letzteres prüft
      // _getDirectionConstraints() (liefert nur Felder, bei denen die fehlende
      // Richtung tatsächlich noch möglich wäre).
      gridIsFinished() {
        return (
          this.grid.every((row) => row.every((field) => !field.isEmpty)) &&
          this._getDirectionConstraints().length === 0
        );
      }

      step() {
        // Fertige Grids nicht weiter verändern (sonst können Validierung/Reshaping
        // ein bereits volles Grid wieder aufbrechen)
        if (this.gridIsFinished()) {
          this._log(
            "FERTIG",
            "Grid ist vollständig, keine leeren Felder mehr.",
          );
          return;
        }

        this.stepCount++;

        // Ein Step tut genau eine Sache: entweder genau einen offenen Fehler
        // beheben, oder - falls das Grid aktuell fehlerfrei ist - genau ein
        // neues Wort platzieren. Nie beides, nie mehrere Fixes hintereinander
        // in einem Aufruf (das übernimmt der jeweils nächste step()-Aufruf).
        let fix = this._findNextFix();
        if (fix) {
          let detail = this._applyFix(fix);
          this._markStructuralForcedFields();
          this.updateGrid();
          this._log("FIX · " + fix.type, detail);
          return;
        }

        let that = this,
          location,
          dummy,
          detail,
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
            let forcedField = that.forcedDummys[0];
            let removedDescription = this._describeDummy(this.getLastDummy());
            this.getLastDummy().shape();
            detail = `Erzwungenes Hinweisfeld (${forcedField.x},${forcedField.y}) hat keine Möglichkeiten mehr -> zuletzt platziertes Wort ${removedDescription} entfernt/umgeformt`;
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
          // Keine markierten Positionen übrig: genau ein verbliebenes leeres
          // Feld als optionale Position markieren. Kein rekursiver step()
          // mehr hier - der nächste step()-Aufruf greift die neue Markierung
          // ganz normal über _getOptionalDummyLocations() auf.
          let marked = false;
          let emptyForbidden = [];
          for (let y = 0; y < that.height && !marked; y++) {
            for (let x = 0; x < that.width && !marked; x++) {
              if (!that.grid[y][x].isEmpty) {
                continue;
              }
              if (that.isClueForbidden(x, y)) {
                emptyForbidden.push(that.grid[y][x]);
                continue;
              }
              that.grid[y][x].mark(that._structuralForceKey, {
                forced: false,
              });
              detail = `Keine markierten Positionen mehr -> Feld (${x},${y}) als neue optionale Position markiert`;
              marked = true;
            }
          }
          // Nur noch leere Felder in der 2x2-Ecke unten rechts: dort darf kein
          // Hinweisfeld entstehen, sie müssen also über Wörter von außerhalb
          // befüllt werden. Das verantwortliche Wort neu formen.
          if (!marked && emptyForbidden.length > 0) {
            let target = this._pickBacktrackTarget(emptyForbidden);
            let before = this._describeDummy(target);
            target.shape();
            let after = this._describeDummy(target);
            detail = `Nur noch leere Felder in der Ecke unten rechts (${this._describeFields(emptyForbidden)}), dort kein Hinweisfeld möglich: Wort ${before} -> ${after}`;
          }
          this._markStructuralForcedFields();
          this.updateGrid();
          this._log("PLATZIERUNG", detail);
          return;
        }

        if (location != null) {
          dummy = new Dummy(location.x, location.y, that);
          dummy.shape();
          detail = dummy.shaped
            ? `Neues Wort bei (${location.x},${location.y}): "${dummy.direction}" Länge ${dummy.length}`
            : `Neues Wort bei (${location.x},${location.y}) nicht formbar`;
        }

        this._markStructuralForcedFields();

        this.updateGrid();

        this._log("PLATZIERUNG", detail);
      }

      // Baut eine kurze, lesbare Beschreibung eines Dummys/Wortes für den
      // Step-Log, z.B. "(3,2) \"right\" Länge 4".
      _describeDummy(dummy) {
        // dummy.shaped bleibt nach remove() (siehe Dummy.js) stehen, daher
        // zusätzlich prüfen, ob der Dummy noch wirklich im Grid registriert ist.
        if (!dummy || !dummy.shaped || this.dummys.indexOf(dummy) === -1) {
          return "entfernt (keine Möglichkeiten mehr)";
        }
        return `(${dummy.x},${dummy.y}) "${dummy.direction}" Länge ${dummy.length}`;
      }

      // Beschreibt eine Liste betroffener Felder für den Step-Log,
      // z.B. "(1,0), (4,2)".
      _describeFields(fields) {
        if (!fields || fields.length === 0) return "-";
        return fields.map((f) => `(${f.x},${f.y})`).join(", ");
      }

      // Ein Log-Eintrag pro step()-Aufruf: Step-Nummer, Art der Aktion,
      // was konkret passiert ist, und wie viele Felder danach noch offen sind.
      _log(tag, detail) {
        let empty = 0;
        let total = this.width * this.height;
        for (let y = 0; y < this.height; y++) {
          for (let x = 0; x < this.width; x++) {
            if (this.grid[y][x].isEmpty) empty++;
          }
        }
        console.log(
          `[Step ${this.stepCount}] ${tag} — ${detail}  (offen: ${empty}/${total})`,
        );
      }

      // Ermittelt höchstens EIN aktuell offenes Problem im Grid, in der
      // bisherigen Prioritätsreihenfolge (Constraints > Clue-Clumps > Edges >
      // Blocked Fields). Reine Erkennung ohne Seiteneffekte - die eigentliche
      // Korrektur übernimmt _applyFix().
      _findNextFix() {
        let constraints = this._getDirectionConstraints();
        if (constraints.length > 0) {
          return { type: "constraints", fields: constraints };
        }

        // Pflicht-Hinweisfeld in der 2x2-Ecke unten rechts: kann nie erfüllt
        // werden, daher muss die Ursache (das Wort, das die Markierung
        // erzwingt) neu geformt werden.
        let forbiddenForced = this._getForbiddenForcedFields();
        if (forbiddenForced.length > 0) {
          return { type: "cornerClue", fields: forbiddenForced };
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
            return { type: "clueClumps", clumps: clueClumps };
          }
        }

        let impossibleEdges = this._validateEdges();
        if (impossibleEdges.length > 0) {
          return { type: "edges", fields: impossibleEdges };
        }

        let blockedFields = this._getBlockedFields();
        if (blockedFields.length > 0) {
          return { type: "blocked", fields: blockedFields };
        }

        // Pflicht-Hinweisfeld, auf dem kein Wort mehr möglich ist. Steht
        // bewusst am Ende: wurde bisher erst in der Platzierungsphase
        // behandelt, also nur wenn kein anderer Fix offen war.
        let deadField = this._getDeadForcedField();
        if (deadField) {
          return { type: "deadField", field: deadField };
        }

        return null;
      }

      // Wendet genau die eine Korrektur an, die _findNextFix() ermittelt hat,
      // und liefert eine lesbare Beschreibung für den Step-Log zurück.
      _applyFix(fix) {
        switch (fix.type) {
          case "constraints": {
            // Buchstabenfeld(er), die in der fehlenden Richtung keine
            // Wortmöglichkeit mehr haben
            let target = this._pickBacktrackTarget(fix.fields);
            let before = this._describeDummy(target);
            target.shape();
            let after = this._describeDummy(target);
            return `Buchstabenfeld ohne Wortmöglichkeit (${this._describeFields(fix.fields)}): Wort ${before} -> ${after}`;
          }

          case "deadField": {
            let f = fix.field;
            let moved = this._tryMoveClueToDeadField(f);
            if (moved) {
              return `Pflicht-Hinweisfeld (${f.x},${f.y}) ohne Möglichkeit: ${moved}`;
            }
            let before = this._describeDummy(this.getLastDummy());
            this.getLastDummy().shape();
            return `Pflicht-Hinweisfeld (${f.x},${f.y}) ohne Möglichkeit, Verschieben nicht möglich: zuletzt platziertes Wort ${before} entfernt/umgeformt`;
          }

          case "cornerClue": {
            let target = this._pickBacktrackTarget(fix.fields);
            let before = this._describeDummy(target);
            target.shape();
            let after = this._describeDummy(target);
            return `Pflicht-Hinweisfeld in der Ecke unten rechts (${this._describeFields(fix.fields)}): Wort ${before} -> ${after}`;
          }

          case "clueClumps": {
            let target = this._pickBacktrackTarget(fix.clumps.flat());
            let before = this._describeDummy(target);
            target.shape();
            let after = this._describeDummy(target);
            let fieldCount = fix.clumps.reduce((n, c) => n + c.length, 0);
            return `Zu viele benachbarte Hinweisfelder (${fix.clumps.length} Cluster, ${fieldCount} Felder): Wort ${before} -> ${after}`;
          }

          case "edges": {
            let fixDescription = this._fixEdges(fix.fields);
            if (fixDescription) {
              return `Unbefüllbares Randfeld (${this._describeFields(fix.fields)}) behoben: ${fixDescription}`;
            }
            let target = this._pickBacktrackTarget(fix.fields);
            let before = this._describeDummy(target);
            target.shape();
            let after = this._describeDummy(target);
            return `Unbefüllbares Randfeld (${this._describeFields(fix.fields)}) nicht direkt reparierbar: Wort ${before} -> ${after}`;
          }

          case "blocked": {
            let target = this._pickBacktrackTarget();
            let before = this._describeDummy(target);
            target.shape();
            let after = this._describeDummy(target);
            return `Vollständig blockiertes Feld (${this._describeFields(fix.fields)}): Wort ${before} -> ${after}`;
          }
        }
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
        // Das Feld zwei weiter muss die alte Hinweisfeld-Position nach außen
        // abschließen: ein bestehendes Hinweisfeld, ein reserviertes Feld
        // oder der Grid-Rand erfüllen das gleichermaßen.
        let reservedAt = function (x, y) {
          let field = that.getField(x, y);
          return field === null || field.isClueOrReserved;
        };

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
          let descriptions = [];
          fixes.forEach(function (fix) {
            // Mehrere unmögliche Felder können denselben Dummy ersetzen wollen (z.B. ein
            // Hinweisfeld am linken Rand zwischen zwei unmöglichen Feldern). Nur der erste
            // Fix wird angewendet, verbleibende unmögliche Felder werden beim nächsten
            // step()-Aufruf über _findNextFix() erneut erkannt.
            if (replacedDummys.has(fix.replace)) {
              return;
            }
            replacedDummys.add(fix.replace);

            let oldX = fix.replace.x,
              oldY = fix.replace.y,
              oldDirection = fix.replace.direction,
              oldLength = fix.replace.length;

            let index = that.dummys.indexOf(fix.replace);
            that.removeDummyFromGrid(fix.replace);
            let newDummy = new Dummy(fix.field.x, fix.field.y, that);
            newDummy.shape(false, fix.direction, fix.replace.length + 1);

            if (newDummy.shaped) {
              descriptions.push(
                `Wort (${oldX},${oldY}) "${oldDirection}" Länge ${oldLength} ersetzt durch (${newDummy.x},${newDummy.y}) "${newDummy.direction}" Länge ${newDummy.length}`,
              );
            } else {
              // Fix nicht möglich: ursprünglichen Dummy an seiner alten Position in der
              // Reihenfolge wiederherstellen (relevant für _pickBacktrackTarget)
              that.addDummyToGrid(fix.replace);
              that.dummys.splice(that.dummys.indexOf(fix.replace), 1);
              that.dummys.splice(index, 0, fix.replace);
            }
          });
          // Wurde kein Fix angewendet, muss der Aufrufer per Backtracking reagieren
          return descriptions.length > 0 ? descriptions.join("; ") : false;
        }
        return false;
      }

      // Liefert das Pflicht-Hinweisfeld, auf dem aktuell kein Wort mehr möglich
      // ist (gleiche Auswahl wie bisher in der Platzierungsphase), oder null.
      _getDeadForcedField() {
        let probes = this._getForcedDummyLocations().map(
          (field) => new Dummy(field.x, field.y, this),
        );
        probes.sort((a, b) => a.possibilities.length - b.possibilities.length);
        if (probes.length > 0 && probes[0].possibilities.length === 0) {
          return this.getField(probes[0].x, probes[0].y);
        }
        return null;
      }

      // Alle Pflicht-Hinweisfelder, auf denen aktuell kein Wort möglich ist
      _getDeadForcedFields() {
        return this._getForcedDummyLocations().filter(
          (field) => new Dummy(field.x, field.y, this).possibilities.length === 0,
        );
      }

      // Zustand der offenen Probleme vor einer Reparatur, zum Vergleich mit
      // _createdNewProblem()
      _problemsBefore() {
        return { dead: new Set(this._getDeadForcedFields()) };
      }

      // true, wenn nach einer Reparatur ein totes Pflicht-Hinweisfeld existiert,
      // das vorher nicht tot war. Eine solche Reparatur verschiebt das Problem
      // nur und führt sonst zu Schleifen. (Neue Buchstabenfelder ohne
      // Kreuzungsmöglichkeit werden bewusst NICHT geprüft: das hat im Test
      // nützliche Verschiebungen verhindert, die der constraints-Fix danach
      // ohnehin auflöst.)
      _createdNewProblem(before) {
        return this._getDeadForcedFields().some((f) => !before.dead.has(f));
      }

      // Versucht, ein bestehendes Wort so zu verschieben und zu verlängern,
      // dass das tote Pflicht-Hinweisfeld zu seinem neuen Hinweisfeld wird.
      // Gesucht wird vom toten Feld aus nach rechts bzw. unten das erste
      // Hinweisfeld; in Frage kommt es nur, wenn sein Wort in derselben Linie
      // verläuft ("right" bzw. "down") - dann wird das alte Hinweisfeld zum
      // Buchstaben des verlängerten Wortes. Liefert eine Beschreibung oder
      // null (Grid unverändert).
      _tryMoveClueToDeadField(dead) {
        let candidates = [
          { stepX: 1, stepY: 0, direction: "right" },
          { stepX: 0, stepY: 1, direction: "down" },
        ];
        for (const c of candidates) {
          let clueField = this._findFirstClue(dead.x, dead.y, c.stepX, c.stepY);
          if (!clueField || clueField.clueFor.direction !== c.direction) {
            continue;
          }
          let word = clueField.clueFor;
          let distance = c.stepX
            ? clueField.x - dead.x
            : clueField.y - dead.y;
          let newLength = word.length + distance;
          if (newLength > this.maxLength) {
            continue;
          }
          let result = this._moveClue(word, dead, newLength);
          if (result) {
            return result;
          }
        }
        return null;
      }

      // Erstes Hinweisfeld ab (x,y) in Richtung (stepX,stepY). Bricht an einem
      // leeren, reservierten Feld ab (das muss selbst Hinweisfeld werden und
      // kann nicht zum Buchstaben des verschobenen Wortes werden).
      _findFirstClue(x, y, stepX, stepY) {
        let field = this.getField(x + stepX, y + stepY);
        while (field) {
          if (field.isClue) {
            return field;
          }
          if (field.isEmpty && field.reserved) {
            return null;
          }
          field = this.getField(field.x + stepX, field.y + stepY);
        }
        return null;
      }

      // Verschiebt das Hinweisfeld von `word` auf `dead` (gleiche Richtung,
      // `newLength`). Wörter, die ein Feld des verschobenen Wortes als
      // Pflicht-Hinweisfeld halten (forcedBy), werden vorher so verlängert,
      // dass sie durch dieses Feld hindurchlaufen. Schlägt ein Teil fehl,
      // wird alles zurückgerollt.
      _moveClue(word, dead, newLength) {
        let snapshot = this._snapshotState();
        let problemsBefore = this._problemsBefore();
        let oldDirection = word.direction;
        let oldDescription = this._describeDummy(word);

        let rollback = () => {
          this._restoreState(snapshot);
          return null;
        };

        this.removeDummyFromGrid(word);

        // Felder, die das verschobene Wort belegen würde
        let path = [];
        for (let i = 1; i <= newLength; i++) {
          let field =
            oldDirection === "right"
              ? this.getField(dead.x + i, dead.y)
              : this.getField(dead.x, dead.y + i);
          if (!field) {
            return rollback();
          }
          path.push(field);
        }

        // Wörter, die eines dieser Felder als Pflicht-Hinweisfeld halten, so
        // verlängern, dass sie hindurchlaufen (inkl. Folgeverlängerungen)
        let extended = this._extendToCover(this._dummyOwnersOf(path));
        if (extended === null) {
          return rollback();
        }

        let moved = new Dummy(dead.x, dead.y, this);
        moved.shape(false, oldDirection, newLength);
        if (!moved.shaped || this._createdNewProblem(problemsBefore)) {
          return rollback();
        }

        let extras = extended.map((e) => `; dafür ${e}`).join("");
        return `Wort ${oldDescription} verschoben nach (${dead.x},${dead.y}), Länge ${newLength}${extras}`;
      }

      // Ordnet jedem Wort, das eines der Felder als Pflicht-Hinweisfeld hält,
      // die betroffenen Felder zu (Map Dummy -> Set von Feldern).
      _dummyOwnersOf(fields) {
        let owners = new Map();
        fields.forEach((field) => {
          field.forcedBy.forEach((owner) => {
            if (!(owner instanceof Dummy)) {
              return;
            }
            if (!owners.has(owner)) {
              owners.set(owner, new Set());
            }
            owners.get(owner).add(field);
          });
        });
        return owners;
      }

      // Verlängert jedes Wort in `required` (Map Dummy -> Felder) so, dass es
      // durch alle zugeordneten Felder hindurchläuft. Werden dabei neue Felder
      // belegt, die ein anderes Wort als Pflicht-Hinweisfeld hält, muss auch
      // dieses Wort verlängert werden - bis keine solchen Felder mehr übrig
      // sind. Liefert die Beschreibungen der Verlängerungen oder null, wenn
      // ein betroffenes Wort nicht passend verlängert werden kann. Bei null
      // muss der Aufrufer den Zustand zurückrollen.
      _extendToCover(required) {
        let descriptions = [];
        for (let round = 0; round < 50; round++) {
          let next = null;
          for (const [dummy, cells] of required) {
            if (![...cells].every((cell) => this._wordCovers(dummy, cell))) {
              next = dummy;
              break;
            }
          }
          if (!next) {
            return descriptions;
          }

          let description = this._describeDummy(next);
          let oldFields = new Set(this._wordFields(next));
          let newLength = this._lengthToCover(next, [...required.get(next)]);
          if (newLength === null) {
            return null;
          }
          this.removeDummyFromGrid(next);
          next.restoreShape(next.direction, newLength);
          descriptions.push(`Wort ${description} verlängert auf ${newLength}`);

          let newFields = this._wordFields(next).filter((f) => !oldFields.has(f));
          this._dummyOwnersOf(newFields).forEach((cells, owner) => {
            if (owner === next) {
              return;
            }
            if (!required.has(owner)) {
              required.set(owner, new Set());
            }
            cells.forEach((cell) => required.get(owner).add(cell));
          });
        }
        return null;
      }

      // Buchstabenfelder eines (geformten) Wortes
      _wordFields(dummy) {
        let fields = [];
        for (let i = 0; i < dummy.length; i++) {
          fields.push(
            dummy.horizontal
              ? this.getField(dummy.startX + i, dummy.startY)
              : this.getField(dummy.startX, dummy.startY + i),
          );
        }
        return fields;
      }

      _wordCovers(dummy, field) {
        if (!dummy.shaped || this.dummys.indexOf(dummy) === -1) {
          return false;
        }
        return this._wordFields(dummy).indexOf(field) !== -1;
      }

      // Sichert den kompletten Grid-Zustand (Feldinhalte, Marker, Formen und
      // Reihenfolge der Dummys), damit ein gescheiterter Reparaturversuch exakt
      // zurückgenommen werden kann. Ein bloßes erneutes Einsetzen der Wörter
      // reicht dafür nicht: Marker werden dabei im dann aktuellen Grid neu
      // berechnet und können vom ursprünglichen Stand abweichen.
      _snapshotState() {
        let fields = [];
        this.grid.forEach((row) => {
          row.forEach((field) => {
            fields.push({
              field: field,
              clueFor: field.clueFor,
              dummyHorizontal: field.dummyHorizontal,
              dummyVertical: field.dummyVertical,
              forcedBy: new Set(field.forcedBy),
              markedBy: new Set(field.markedBy),
            });
          });
        });
        let dummys = this.dummys.map((dummy) => ({
          dummy: dummy,
          shaped: dummy.shaped,
          startX: dummy.startX,
          startY: dummy.startY,
          horizontal: dummy.horizontal,
          direction: dummy.direction,
          length: dummy.length,
        }));
        return { fields: fields, dummys: dummys, order: this.dummys.slice() };
      }

      _restoreState(snapshot) {
        snapshot.fields.forEach((s) => {
          s.field.clueFor = s.clueFor;
          s.field.dummyHorizontal = s.dummyHorizontal;
          s.field.dummyVertical = s.dummyVertical;
          s.field.forcedBy = new Set(s.forcedBy);
          s.field.markedBy = new Set(s.markedBy);
        });
        snapshot.dummys.forEach((s) => {
          s.dummy.shaped = s.shaped;
          s.dummy.startX = s.startX;
          s.dummy.startY = s.startY;
          s.dummy.horizontal = s.horizontal;
          s.dummy.direction = s.direction;
          s.dummy.length = s.length;
        });
        this.dummys = snapshot.order.slice();
        this._evaluateGrid();
      }

      // Kürzeste gültige Länge (gleiche Richtung, nur Verlängerung), mit der
      // `dummy` durch alle `cells` hindurchläuft - oder null. Grundlage sind
      // die tatsächlich gültigen Längen (Dummy._getValidLengths) im aktuellen
      // Grid, ohne den Dummy selbst.
      _lengthToCover(dummy, cells) {
        let direction = dummy.direction;
        let oldLength = dummy.length;
        let start = dummy.horizontal ? dummy.startX : dummy.startY;
        let need = Math.max(
          ...cells.map((c) => (dummy.horizontal ? c.x : c.y)),
        );
        let onLine = cells.every((c) =>
          dummy.horizontal ? c.y === dummy.startY : c.x === dummy.startX,
        );
        if (!onLine) {
          return null;
        }

        this.removeDummyFromGrid(dummy);
        let lengths = dummy._getValidLengths(direction);
        dummy.restoreShape(direction, oldLength);

        let best = null;
        lengths.forEach((length) => {
          if (length <= oldLength || start + length - 1 < need) {
            return;
          }
          if (best === null || length < best) {
            best = length;
          }
        });
        return best;
      }

      // Felder, auf denen kein Hinweisfeld liegen darf (siehe
      // isClueForbidden), die aber (durch ein Wort oder strukturell) als
      // Pflicht-Hinweisfeld markiert sind.
      _getForbiddenForcedFields() {
        let fields = [];
        this.grid.forEach((row) => {
          row.forEach((field) => {
            if (field.reserved && this.isClueForbidden(field.x, field.y)) {
              fields.push(field);
            }
          });
        });
        return fields;
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
          .getProperty("/targetAverageWordLength");

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
        let average = totalLength / this.dummys.length;
        this.controller
          .getView()
          .getModel("settings")
          .setProperty("/currentAverageWordLength", average);
        return average;
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
            if (topleft.isClueOrReserved) {
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
              if (bottomleft.isClueOrReserved) {
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
              if (topright.isClueOrReserved) {
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
          row.y = y;
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
        this.controller.resetArrows();
        this.controller.addArrows();
      }

      addDummyToGrid(dummy) {
        this.dummys.push(dummy);
        this._addDummyLetters(dummy);
        this._markForcedWordLocations(dummy);
        this._markOptionalWordLocations(dummy);
        this._evaluateGrid();
        this._markStructuralForcedFields();
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
        this._getForcedMarkerPositions(dummy).forEach((field) => {
          field.mark(dummy, { forced: true });
        });
      }

      // Liefert die Felder, die ein Wort mit der Form `w` (x, y, startX,
      // startY, horizontal, direction, length) als Pflicht-Hinweisfeld
      // markiert. Reine Berechnung ohne Seiteneffekte - wird sowohl beim
      // tatsächlichen Markieren (_markForcedWordLocations) als auch beim
      // Prüfen möglicher Wortformen (Dummy._getValidLengths) verwendet, damit
      // beides nie auseinanderläuft.
      //
      // Visualisierung in den Kommentaren:
      //    C: Hinweisfeld
      //    WORD: das Wort in horizontaler Ausrichtung
      //    #: Feld, das als Pflicht-Hinweisfeld markiert wird
      _getForcedMarkerPositions(w) {
        let positions = [];
        let add = (x, y, onlyIfEmpty) => {
          let field = this.getField(x, y);
          if (!field || (onlyIfEmpty && !field.isEmpty)) {
            return;
          }
          positions.push(field);
        };

        if (w.horizontal) {
          // Hinweisfeld und Wort nicht in einer Linie: Feld 2 neben dem
          // Hinweisfeld
          // |#| | | |        |C| | | |
          // |W|O|R|D|        |W|O|R|D|
          // |C| | | |        |#| | | |
          if (w.y != w.startY) {
            if (w.y > w.startY) {
              add(w.x, w.y - 2, true);
            } else {
              add(w.x, w.y + 2, true);
            }
          }

          // Feld hinter dem Wort
          // |W|O|R|D|#|
          let behindX = w.startX + w.length;
          if (this.getField(behindX, w.startY)) {
            add(behindX, w.startY, false);
            // Wort in der zweiten Zeile: in der ersten Zeile sind keine
            // parallelen Wörter erlaubt, das Feld darüber würde sonst leer
            // bleiben
            if (w.startY == 1) {
              add(behindX, 0, true);
            }
          }

          // Feld vor dem Wort, wenn das Hinweisfeld darüber/darunter liegt
          // |#|W|O|R|D|
          if (this.getField(w.startX - 1, w.startY)) {
            if (w.startY != w.y) {
              add(w.startX - 1, w.startY, false);
            }
            if (w.startY == 1) {
              add(w.startX - 1, 0, true);
            }
          }

          if (w.direction === "right") {
            let below = this.getField(w.x, w.y + 1);
            if (below && below.isLetter) {
              add(w.x, w.y + 2, true);
            }
          }
        }

        // Vertikal: gleiche Logik, auf die andere Ausrichtung übertragen
        else {
          if (w.x != w.startX) {
            if (w.x > w.startX) {
              add(w.x - 2, w.y, true);
            } else {
              add(w.x + 2, w.y, true);
            }
          }

          let behindY = w.startY + w.length;
          if (this.getField(w.startX, behindY)) {
            add(w.startX, behindY, false);
            if (w.startX == 1) {
              add(0, behindY, true);
            }
          }

          if (this.getField(w.startX, w.startY - 1)) {
            if (w.startX != w.x) {
              add(w.startX, w.startY - 1, false);
            }
            if (w.startX == 1) {
              add(0, w.startY - 1, true);
            }
          }

          if (w.direction === "down") {
            let right = this.getField(w.x + 1, w.y);
            if (right && right.isLetter) {
              add(w.x + 2, w.y, true);
            }
          }
        }

        return positions;
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
            that.grid[dummy.y][dummy.x + 2].isEmpty &&
            !that.isClueForbidden(dummy.x + 2, dummy.y)
          ) {
            that.grid[dummy.y][dummy.x + 2].mark(dummy, { forced: false });
          }
        } else {
          if (
            that.grid[dummy.y + 2] &&
            that.grid[dummy.y + 2][dummy.x] &&
            that.grid[dummy.y + 2][dummy.x].isEmpty &&
            !that.isClueForbidden(dummy.x, dummy.y + 2)
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
            if (
              minY >= 0 &&
              that.grid[minY][x].isEmpty &&
              !that.isClueForbidden(x, minY)
            ) {
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
            if (
              minX >= 0 &&
              that.grid[y][minX].isEmpty &&
              !that.isClueForbidden(minX, y)
            ) {
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
    };
  },
);
