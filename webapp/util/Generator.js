sap.ui.define(
  [
    "sap/ui/model/json/JSONModel",
    "kreuzwort/kreuzwort/util/Dummy",
    "kreuzwort/kreuzwort/util/Field",
    "kreuzwort/kreuzwort/util/Random",
  ],
  function (JSONModel, Dummy, Field, Random) {
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
        // Entscheidungsstapel für die Suche (siehe step())
        this.stack = [];
        // Leere Felder, die im aktuellen Zweig kein Hinweisfeld werden dürfen
        this.excluded = new Set();
        // true, wenn alle Möglichkeiten durchsucht sind
        this.exhausted = false;
        // Neustarts: Nummer des aktuellen Versuchs und Steps darin
        this.attempt = 0;
        this.attemptSteps = 0;
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
        this.stepCount = 0;
        this.attempt = 0;
        this.refreshSettings();
        this._initRandom();
        let detail = this._startAttempt();
        this.controller.setGrid(this.getGrid());
        this._log(
          "START",
          `Grid ${this.width}x${this.height}, Seed ${this.random.seed}, ${detail}`,
        );
      }

      // Beginnt einen neuen Versuch mit leerem Grid und setzt das Anfangswort.
      // Der Zufallsgenerator läuft dabei weiter (wird nicht neu geseedet),
      // damit der komplette Lauf inklusive aller Neustarts über den Seed aus
      // /currentSeed reproduzierbar bleibt.
      _startAttempt() {
        this.dummys = [];
        this.stack = [];
        this.excluded = new Set();
        this.exhausted = false;
        this.attempt++;
        this.attemptSteps = 0;
        // Nachbearbeitung (siehe _optimizeStep)
        this.optimization = {
          done: false,
          attempts: new Map(),
          start: null,
          improvements: 0,
        };
        this.resetGrid();

        let frame = this._createFirstFrame();
        let detail;
        if (frame.candidates.length > 0) {
          this.stack.push(frame);
          detail = this._applyCandidate(frame);
        } else {
          this.exhausted = true;
          detail = "kein Anfangswort möglich";
        }
        this._publishAverageWordLength();
        return detail;
      }

      // Maximale Anzahl Steps für den aktuellen Versuch: abhängig von der
      // Gridgröße (größere Grids brauchen mehr Entscheidungen) und wachsend
      // mit jedem Neustart, damit auch Grids, die mehr Suche brauchen, eine
      // Chance bekommen. 0 = keine Neustarts.
      _restartLimit() {
        if (!this.restartStepsPerField) {
          return Infinity;
        }
        return Math.round(
          this.restartStepsPerField *
            this.width *
            this.height *
            Math.pow(this.restartGrowth, this.attempt - 1),
        );
      }

      // Zufallsgenerator für diesen Durchlauf. Ist in den Settings ein Seed
      // gesetzt, wird er verwendet (reproduzierbares Rätsel), sonst wird ein
      // neuer erzeugt. Der tatsächlich verwendete Seed steht danach in
      // /currentSeed, damit ein Rätsel später gezielt nachgebaut werden kann.
      _initRandom() {
        let settings = this.controller.getView().getModel("settings");
        let seed = settings.getProperty("/seed");
        if (seed === null || seed === undefined || seed === "") {
          seed = Random.createSeed();
        }
        this.random = new Random(seed);
        settings.setProperty("/currentSeed", this.random.seed);
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
        // Zufall (siehe _shuffleTop) und Neustarts (siehe _restartLimit)
        this.randomTop = settings.getProperty("/randomTopCandidates");
        this.randomMinScoreRatio = settings.getProperty("/randomMinScoreRatio");
        this.restartStepsPerField = settings.getProperty(
          "/restartStepsPerField",
        );
        this.restartGrowth = settings.getProperty("/restartGrowth");
        // Nachbearbeitung (siehe _optimizeStep) mit Zielwerten aus den
        // Beispielrätseln
        this.optimizeLayout = settings.getProperty("/optimizeLayout");
        this.optimizeAttemptsPerTarget = settings.getProperty(
          "/optimizeAttemptsPerTarget",
        );
        this.targetShareTwoLetterWords = settings.getProperty(
          "/targetShareTwoLetterWords",
        );
        this.targetShareShortWords = settings.getProperty(
          "/targetShareShortWords",
        );
        this.targetClusterShare = settings.getProperty("/targetClusterShare");
        this.toleranceTwoLetterWords = settings.getProperty(
          "/toleranceTwoLetterWords",
        );
        this.toleranceShortWords = settings.getProperty("/toleranceShortWords");
        this.toleranceClusterShare = settings.getProperty(
          "/toleranceClusterShare",
        );
        this.maxClusterBlockSize = settings.getProperty("/maxClusterBlockSize");
        this.optimizeRefillSteps = settings.getProperty("/optimizeRefillSteps");
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

      // Ein Step tut genau eine Sache:
      // - Konflikt im Grid (Sackgasse): mit einem kleinen Umbau reparieren
      //   (REPARATUR) oder zur jüngsten Entscheidung zurückgehen, die noch
      //   einen unversuchten Kandidaten hat, und diesen anwenden (BACKTRACK)
      // - sonst: neue Entscheidungsebene anlegen und ihren ersten Kandidaten
      //   anwenden (ENTSCHEIDUNG)
      // Jede Ebene hat endlich viele Kandidaten und jede Entscheidung füllt
      // ein leeres Feld (als Hinweisfeld oder als ausgeschlossene Position).
      // Die Suche endet daher immer: mit einem fertigen Grid oder, wenn alle
      // Möglichkeiten durchprobiert sind, ohne Lösung.
      // Braucht ein Versuch zu lange (frühe Fehlentscheidung, unter der sehr
      // viele Kombinationen liegen), wird mit leerem Grid und anderer
      // zufälliger Reihenfolge neu begonnen (NEUSTART).
      // Ist das Grid fertig, wird es nachträglich an die Kennzahlen der
      // Beispielrätsel angenähert (OPTIMIERUNG, siehe _optimizeStep).
      step() {
        if (this.gridIsFinished()) {
          if (this.optimizeLayout && !this.optimization.done) {
            this.stepCount++;
            let detail = this._optimizeStep();
            this.updateGrid();
            this._log("OPTIMIERUNG", detail);
            return;
          }
          this._log(
            "FERTIG",
            "Grid ist vollständig, keine leeren Felder mehr.",
          );
          return;
        }
        if (this.exhausted) {
          this._log(
            "KEINE LÖSUNG",
            "Alle Möglichkeiten wurden durchsucht. Bitte neu starten.",
          );
          return;
        }

        this.stepCount++;

        if (this.attemptSteps >= this._restartLimit()) {
          let steps = this.attemptSteps;
          let detail = this._startAttempt();
          this.updateGrid();
          this._log(
            `NEUSTART · Versuch ${this.attempt}`,
            `kein Ergebnis nach ${steps} Steps, nächstes Limit ${this._restartLimit()} Steps, ${detail}`,
          );
          return;
        }
        this.attemptSteps++;

        let result = this._searchStep();
        this.updateGrid();
        this._log(result.tag, result.detail);
      }

      // true, wenn der Generator nichts mehr zu tun hat: Grid fertig und
      // nachbearbeitet, oder keine Lösung
      isDone() {
        if (this.exhausted) {
          return true;
        }
        return (
          this.gridIsFinished() &&
          (!this.optimizeLayout || this.optimization.done)
        );
      }

      // Ein Schritt der Suche (Reparatur, Backtrack oder Entscheidung) ohne
      // UI-Aktualisierung. Liefert Art und Beschreibung für den Log.
      _searchStep() {
        let conflict = this._findConflict();
        let frame = null;
        if (!conflict) {
          frame = this._createFrame();
          if (!frame) {
            conflict = { type: "noPosition", fields: this._getEmptyFields() };
          } else if (frame.candidates.length === 0) {
            conflict = { type: "deadField", fields: [frame.field] };
          }
        }

        if (conflict) {
          let reason = this._describeConflict(conflict);

          // Lässt sich der Konflikt mit einem kleinen Umbau lösen, wird das
          // zuerst versucht (siehe _createRepairFrame)
          let repair = this._createRepairFrame(conflict);
          if (repair) {
            this.stack.push(repair);
            let detail = this._applyFirstWorking(repair);
            if (detail) {
              return {
                tag: `REPARATUR #${this.stack.length} · ${conflict.type}`,
                detail: `${reason} -> ${detail}`,
              };
            }
            this.stack.pop();
          }

          let detail = this._backtrack();
          return {
            tag: "BACKTRACK · " + conflict.type,
            detail: `${reason} -> ${detail}`,
          };
        }

        this.stack.push(frame);
        return {
          tag: `ENTSCHEIDUNG #${this.stack.length}`,
          detail: this._applyCandidate(frame),
        };
      }

      // Ermittelt höchstens EINEN Konflikt, also einen Zustand, aus dem kein
      // fertiges Grid mehr werden kann (Reihenfolge: Constraints > Ecke >
      // Clue-Clumps > Ränder > blockierte Felder > ausgeschlossene Felder).
      // Reine Erkennung ohne Seiteneffekte.
      _findConflict() {
        let constraints = this._getDirectionConstraints();
        if (constraints.length > 0) {
          return { type: "constraints", fields: constraints };
        }

        // Pflicht-Hinweisfeld in der 2x2-Ecke unten rechts: kann nie erfüllt
        // werden
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

        // Position wurde in diesem Zweig als "kein Hinweisfeld" entschieden,
        // ist inzwischen aber Pflicht-Hinweisfeld geworden
        let excludedForced = [...this.excluded].filter(
          (field) => field.isEmpty && field.reserved,
        );
        if (excludedForced.length > 0) {
          return { type: "excluded", fields: excludedForced };
        }

        return null;
      }

      _describeConflict(conflict) {
        let fields = this._describeFields(conflict.fields);
        switch (conflict.type) {
          case "constraints":
            return `Buchstabenfeld ohne Wortmöglichkeit (${fields})`;
          case "cornerClue":
            return `Pflicht-Hinweisfeld in der Ecke unten rechts (${fields})`;
          case "clueClumps": {
            let fieldCount = conflict.clumps.reduce((n, c) => n + c.length, 0);
            return `Zu viele benachbarte Hinweisfelder (${conflict.clumps.length} Cluster, ${fieldCount} Felder)`;
          }
          case "edges":
            return `Unbefüllbares Randfeld (${fields})`;
          case "blocked":
            return `Vollständig blockiertes Feld (${fields})`;
          case "excluded":
            return `Ausgeschlossene Position muss Hinweisfeld werden (${fields})`;
          case "deadField":
            return `Pflicht-Hinweisfeld ohne Möglichkeit (${fields})`;
          case "noPosition":
            return `Keine Position mehr, an der ein Wort möglich ist (offen: ${fields})`;
        }
      }

      // Entscheidungsebene (Frame):
      //   kind:       "first" | "forced" | "optional" | "free" | "repair"
      //   field:      Position des Hinweisfelds, um das es geht (bei
      //               "repair" das Konfliktfeld)
      //   snapshot:   Zustand vor der Entscheidung (für das Zurückgehen)
      //   signature:  Kurzform dieses Zustands (siehe _stateSignature)
      //   candidates: geordnete Liste der Möglichkeiten an dieser Position,
      //               { direction, length } oder { exclude: true }, bei
      //               "repair" die möglichen Umbauten
      //   index:      aktuell angewendeter Kandidat

      // Erste Ebene: das Anfangswort startet immer links oben. Kandidaten sind
      // alle dort möglichen Formen. Ist in den Settings eine Länge gesetzt,
      // kommt die gewünschte Form zuerst, bei Länge 0 wird sie wie bei jeder
      // anderen Ebene zufällig aus den besten gewählt.
      _createFirstFrame() {
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

        let candidates = this._getShapeCandidates(new Dummy(x, y, this));
        if (length > 0) {
          let wanted = candidates.findIndex(
            (c) => c.direction === direction && c.length === length,
          );
          if (wanted > 0) {
            candidates.unshift(candidates.splice(wanted, 1)[0]);
          }
        }
        this.firstWordField = this.getField(x, y);
        this.firstWordFixed = length > 0;
        return this._newFrame("first", this.firstWordField, candidates);
      }

      // Nächste Ebene nach dem Anfangswort. Pflicht-Hinweisfelder haben
      // Vorrang: von ihnen wird das mit den wenigsten Möglichkeiten genommen
      // (scheitert am ehesten, Sackgassen fallen so früh auf). Da es zwingend
      // Hinweisfeld werden muss, sind nur seine Formen Kandidaten - hat es
      // keine, ist das ein Konflikt (leere Kandidatenliste).
      // Sonst wird zufällig eine der besten Positionen genommen, an denen ein
      // Wort möglich ist (siehe _getCandidatePositions/_pickPosition). Letzter
      // Kandidat ist dort, die Position auszuschließen: Sie bleibt dann in
      // diesem Zweig frei von Hinweisfeldern und wird nicht noch einmal in
      // anderer Reihenfolge durchprobiert.
      // Liefert null, wenn es keine Position mehr gibt.
      _createFrame() {
        let forced = this._getForcedDummyLocations();
        if (forced.length > 0) {
          let probes = forced.map((field) => new Dummy(field.x, field.y, this));
          // stabil sortiert: bei Gleichstand bleibt die Score-Reihenfolge
          probes.sort((a, b) => a.possibilities.length - b.possibilities.length);
          return this._newFrame(
            "forced",
            this.getField(probes[0].x, probes[0].y),
            this._getShapeCandidates(probes[0]),
          );
        }

        let pick = this._pickPosition();
        if (!pick) {
          return null;
        }
        let candidates = this._getShapeCandidates(pick.dummy);
        candidates.push({ exclude: true });
        return this._newFrame(pick.kind, pick.field, candidates);
      }

      // Wählt die Position für die nächste nicht erzwungene Entscheidung: Die
      // ersten Positionen (in der Reihenfolge von _getCandidatePositions), an
      // denen ein Wort möglich ist, bilden die Auswahl - höchstens so viele
      // wie randomTopCandidates und nur solche, die gleichwertig zur ersten
      // sind (gleiche Art, gleich viele angrenzende Hinweisfelder). Daraus
      // wird nach Feld-Score gewichtet gezogen (siehe _shuffleTop).
      _pickPosition() {
        let optional = new Set(this._getOptionalDummyLocations());
        let pool = [];
        for (const field of this._getCandidatePositions()) {
          let dummy = new Dummy(field.x, field.y, this);
          if (dummy.possibilities.length === 0) {
            continue;
          }
          let entry = {
            field: field,
            dummy: dummy,
            kind: optional.has(field) ? "optional" : "free",
            adjClues: this._getAdjClues(field),
          };
          if (
            pool.length > 0 &&
            (entry.kind !== pool[0].kind || entry.adjClues !== pool[0].adjClues)
          ) {
            break;
          }
          pool.push(entry);
          if (pool.length >= this.randomTop) {
            break;
          }
        }
        if (pool.length === 0) {
          return null;
        }
        return this._shuffleTop(pool, (entry) => entry.field.score)[0];
      }

      _newFrame(kind, field, candidates) {
        return {
          kind: kind,
          field: field,
          snapshot: this._snapshotState(),
          signature: this._stateSignature(),
          candidates: candidates,
          index: 0,
        };
      }

      // Formen eines Dummys als Kandidaten: die besten in zufälliger,
      // gewichteter Reihenfolge, danach alle übrigen nach Bewertung. Beim
      // Neuaufbau in der Nachbearbeitung (preferLongWords) kommen Formen mit
      // 2-3 Buchstaben erst ganz am Ende.
      _getShapeCandidates(dummy) {
        let candidates = this._shuffleTop(
          dummy.possibilities,
          (p) => p.score,
        ).map((p) => ({
          direction: p.direction,
          length: p.length,
        }));
        if (this.preferLongWords) {
          candidates = candidates
            .filter((c) => c.length > 3)
            .concat(candidates.filter((c) => c.length <= 3));
        }
        return candidates;
      }

      // Zufällige, gewichtete Reihenfolge für die besten Einträge einer nach
      // Score absteigend sortierten Liste. In Frage kommen höchstens die
      // ersten randomTopCandidates, und nur, wenn ihr Score mindestens
      // randomMinScoreRatio * bester Score erreicht. Gewichtet wird mit dem
      // Abstand zu dieser Mindestgrenze: der beste Eintrag ist am
      // wahrscheinlichsten, ein Eintrag knapp an der Grenze kommt kaum vor.
      // Alle übrigen Einträge folgen danach in ihrer Reihenfolge - sie
      // bleiben für das Backtracking erhalten, werden aber nie bevorzugt.
      _shuffleTop(items, scoreOf) {
        if (items.length < 2 || !(this.randomTop > 1)) {
          return items.slice();
        }
        let best = scoreOf(items[0]);
        if (!(best > 0)) {
          return items.slice();
        }
        let minScore = best * this.randomMinScoreRatio;
        let poolSize = 1;
        while (
          poolSize < items.length &&
          poolSize < this.randomTop &&
          scoreOf(items[poolSize]) >= minScore
        ) {
          poolSize++;
        }

        let pool = items.slice(0, poolSize);
        let ordered = [];
        while (pool.length > 0) {
          let weights = pool.map((item) => Math.max(0, scoreOf(item) - minScore));
          ordered.push(pool.splice(this._weightedIndex(weights), 1)[0]);
        }
        return ordered.concat(items.slice(poolSize));
      }

      // Zufälliger Index, Wahrscheinlichkeit proportional zum Gewicht. Sind
      // alle Gewichte 0, ist jeder Index gleich wahrscheinlich.
      _weightedIndex(weights) {
        let total = weights.reduce((sum, w) => sum + w, 0);
        if (total <= 0) {
          return this.random.int(0, weights.length - 1);
        }
        let r = this.random.next() * total;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r < 0) {
            return i;
          }
        }
        return weights.length - 1;
      }

      // Mögliche Positionen für ein neues (nicht erzwungenes) Wort in
      // Reihenfolge der Priorität: zuerst die markierten Positionen (wenige
      // angrenzende Hinweisfelder, dann hoher Score), danach alle übrigen
      // leeren Felder zeilenweise. Ausgeschlossene Positionen und die 2x2-Ecke
      // unten rechts fallen weg.
      _getCandidatePositions() {
        let optional = this._getOptionalDummyLocations().filter(
          (field) => !this.excluded.has(field),
        );
        optional.sort((a, b) => {
          let adjClueDiff = this._getAdjClues(a) - this._getAdjClues(b);
          if (adjClueDiff !== 0) {
            return adjClueDiff;
          }
          return b.score - a.score;
        });

        let rest = this._getEmptyFields().filter(
          (field) =>
            !field.nextWordLocation &&
            !this.excluded.has(field) &&
            !this.isClueForbidden(field.x, field.y),
        );
        return optional.concat(rest);
      }

      _getEmptyFields() {
        let fields = [];
        this.grid.forEach((row) => {
          row.forEach((field) => {
            if (field.isEmpty) {
              fields.push(field);
            }
          });
        });
        return fields;
      }

      // Wendet ab frame.index den ersten Kandidaten an, der sich anwenden
      // lässt (Umbauten können scheitern, Wortformen nicht). Liefert dessen
      // Beschreibung oder null - der Zustand ist dann wie im Snapshot.
      _applyFirstWorking(frame) {
        for (; frame.index < frame.candidates.length; frame.index++) {
          let detail = this._applyCandidate(frame);
          if (detail) {
            return detail;
          }
          this._restoreState(frame.snapshot);
        }
        return null;
      }

      // Wendet den aktuellen Kandidaten einer Ebene an. Liefert eine
      // Beschreibung, bei einem nicht möglichen Umbau null.
      _applyCandidate(frame) {
        let candidate = frame.candidates[frame.index];
        let field = frame.field;
        let where = `${this._describeFrameKind(frame)} (${field.x},${field.y})`;
        let count = `(Kandidat ${frame.index + 1}/${frame.candidates.length})`;

        if (frame.kind === "repair") {
          let detail = this._applyRepair(candidate);
          return detail ? `${detail} ${count}` : null;
        }

        if (candidate.exclude) {
          this.excluded.add(field);
          return `${where} wird kein Hinweisfeld, alle Formen gescheitert ${count}`;
        }

        new Dummy(field.x, field.y, this).restoreShape(
          candidate.direction,
          candidate.length,
        );
        this._markStructuralForcedFields();
        return `${where}: "${candidate.direction}" Länge ${candidate.length} ${count}`;
      }

      _describeFrameKind(frame) {
        switch (frame.kind) {
          case "first":
            return "Anfangswort";
          case "forced":
            return "Pflicht-Hinweisfeld";
          case "optional":
            return "Optionale Position";
          case "free":
            return "Freies Feld";
          case "repair":
            return "Reparatur";
        }
      }

      // Geht zur jüngsten Ebene zurück, die noch einen anwendbaren Kandidaten
      // hat: Zustand exakt wie vor dieser Ebene herstellen, dann den nächsten
      // Kandidaten anwenden. Ebenen ohne weitere Kandidaten werden dabei
      // verworfen. Ist der Stapel leer, gibt es keine Lösung.
      _backtrack() {
        let wordsBefore = this.dummys.length;
        let lastPopped = null;
        while (this.stack.length > 0) {
          let frame = this.stack[this.stack.length - 1];
          if (frame.index + 1 < frame.candidates.length) {
            this._restoreState(frame.snapshot);
            frame.index++;
            let detail = this._applyFirstWorking(frame);
            if (detail) {
              let level = frame.kind === "repair" ? "Reparatur" : "Entscheidung";
              let removed = wordsBefore - frame.snapshot.order.length;
              return `zurück zu ${level} #${this.stack.length} (${removed} Wörter entfernt), ${detail}`;
            }
          }
          lastPopped = this.stack.pop();
        }

        this.exhausted = true;
        if (lastPopped) {
          this._restoreState(lastPopped.snapshot);
        }
        return "alle Möglichkeiten durchsucht, KEINE LÖSUNG";
      }

      // Baut eine kurze, lesbare Beschreibung eines Dummys/Wortes für den
      // Step-Log, z.B. "(3,2) \"right\" Länge 4".
      _describeDummy(dummy) {
        // dummy.shaped bleibt nach dem Entfernen stehen, daher zusätzlich
        // prüfen, ob der Dummy noch wirklich im Grid registriert ist.
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
        // Interne Suchschritte beim Neuaufbau in der Nachbearbeitung werden
        // nicht einzeln geloggt
        if (this.silent) {
          return;
        }
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

      // Ermittelt, welche Dummys für ein konfliktverursachendes Feld verantwortlich
      // sind (Wort auf dem Feld selbst, oder - bei leeren "unmöglichen" Feldern wie
      // bei Randkonstellationen - die Wörter auf den direkten Nachbarfeldern).
      // Aktuell nicht verwendet, vorgesehen für Backjumping (direkt zur
      // verursachenden Entscheidung zurückspringen).
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

      // ---- Nachbearbeitung: Wortlängen und Cluster ----
      // Ist das Grid fertig, wird es an die Kennzahlen der Beispielrätsel
      // (50plus.de) angenähert, jeweils mit eigenem Spielraum (tolerance...):
      // - wenige Wörter mit 2 Buchstaben (targetShareTwoLetterWords) bzw.
      //   2-3 Buchstaben (targetShareShortWords)
      // - Cluster: Buchstaben, die waagerecht UND senkrecht gekreuzt werden
      //   und in einem solchen 3x3-Block liegen (targetClusterShare)
      // - keine solchen Blöcke größer als maxClusterBlockSize
      // Pro Step wird eine Problemstelle angegangen: Die Wörter dort werden
      // entfernt und der Bereich mit der normalen Suche neu aufgebaut.
      // Übernommen wird das nur, wenn das Grid wieder perfekt ist und
      // insgesamt näher an den Zielen liegt (siehe _layoutPenalty), sonst wird
      // exakt zurückgesetzt. Sind alle Werte im Zielbereich, ist Schluss.
      _optimizeStep() {
        let opt = this.optimization;
        let quality = this._getLayoutQuality();
        if (opt.start === null) {
          opt.start = quality;
        }

        let target = this._getOptimizationTargets(quality).find(
          (t) =>
            !opt.attempts.has(t.key) ||
            opt.attempts.get(t.key).count < this.optimizeAttemptsPerTarget,
        );
        if (!target) {
          opt.done = true;
          return `beendet: ${this._describeQuality(quality)} (vorher ${this._describeQuality(opt.start)}, ${opt.improvements} Verbesserungen)`;
        }

        let entry = opt.attempts.get(target.key) || { count: 0, cells: target.cells };
        entry.count++;
        opt.attempts.set(target.key, entry);
        let radius = target.kind === "cluster" ? (entry.count >= 3 ? 1 : 0) : entry.count >= 3 ? 2 : 1;

        let result = this._refillRegion(target, radius, quality);
        if (result.improved) {
          opt.improvements++;
          // Ziele in der Nähe des neu aufgebauten Bereichs bekommen wieder
          // volle Versuche, weil sich ihre Umgebung geändert hat
          let near = (f) =>
            f.x >= result.box.minX - 2 &&
            f.x <= result.box.maxX + 2 &&
            f.y >= result.box.minY - 2 &&
            f.y <= result.box.maxY + 2;
          opt.attempts.forEach((e, key) => {
            if (e.cells.some(near)) {
              opt.attempts.delete(key);
            }
          });
          return `${target.description}: Umgebung (${result.removed} Wörter) in ${result.steps} Suchschritten neu aufgebaut -> ${this._describeQuality(this._getLayoutQuality())}`;
        }
        return `${target.description}: keine Verbesserung nach ${result.steps} Suchschritten (Versuch ${entry.count}/${this.optimizeAttemptsPerTarget}, Umgebung ${result.removed} Wörter)`;
      }

      // Kennzahlen des aktuellen Grids für die Nachbearbeitung
      _getLayoutQuality() {
        let words = this.dummys.length;
        let two = this.dummys.filter((d) => d.length === 2);
        let three = this.dummys.filter((d) => d.length === 3);
        let letters = 0;
        this.grid.forEach((row) =>
          row.forEach((f) => {
            if (f.isLetter) letters++;
          }),
        );
        let bigSize = this.maxClusterBlockSize + 1;
        let bigBlocks = this._getCrossedBlocks(bigSize);
        let clusterBlocks = this._getCrossedBlocks(3);
        return {
          words: words,
          letters: letters,
          two: two,
          three: three,
          bigSize: bigSize,
          bigBlocks: bigBlocks,
          bigCells: this._blockCells(bigBlocks).size,
          clusterBlocks: clusterBlocks,
          clusterCells: this._blockCells(clusterBlocks).size,
        };
      }

      // Alle k x k Blöcke, in denen jeder Buchstabe waagerecht und senkrecht
      // gekreuzt wird. Liefert je Block die Liste seiner Felder.
      _getCrossedBlocks(k) {
        let crossed = (x, y) => {
          let f = this.getField(x, y);
          return f && f.hasHorizontalWord && f.hasVerticalWord;
        };
        let blocks = [];
        for (let y = 0; y + k <= this.height; y++) {
          for (let x = 0; x + k <= this.width; x++) {
            let cells = [];
            for (let j = 0; j < k; j++) {
              for (let i = 0; i < k; i++) {
                if (crossed(x + i, y + j)) {
                  cells.push(this.getField(x + i, y + j));
                }
              }
            }
            if (cells.length === k * k) {
              blocks.push(cells);
            }
          }
        }
        return blocks;
      }

      _blockCells(blocks) {
        let cells = new Set();
        blocks.forEach((block) => block.forEach((f) => cells.add(f)));
        return cells;
      }

      // Obergrenzen der Zielbereiche (Zielwert + eigene Toleranz je
      // Kennzahl). Bei den 2-Buchstaben-Wörtern ist immer mindestens eines
      // erlaubt: In kleinen Grids mit 10-15 Wörtern wäre sonst schon ein
      // einziges zu viel, und das ist dort oft strukturell nicht vermeidbar.
      _maxTwoLetterWords(q) {
        return Math.max(
          1,
          (this.targetShareTwoLetterWords + this.toleranceTwoLetterWords) *
            q.words,
        );
      }

      _maxShortWords(q) {
        return (
          (this.targetShareShortWords + this.toleranceShortWords) * q.words
        );
      }

      _maxClusterCells(q) {
        return (
          (this.targetClusterShare + this.toleranceClusterShare) * q.letters
        );
      }

      // Abstand zu den Zielwerten (0 = alles im Zielbereich). Blöcke größer
      // als maxClusterBlockSize wiegen am schwersten, dann 2-Buchstaben-
      // Wörter, dann 2-3-Buchstaben-Wörter, dann Cluster.
      _layoutPenalty(q) {
        return (
          100 * q.bigCells +
          10 * Math.max(0, q.two.length - this._maxTwoLetterWords(q)) +
          3 *
            Math.max(
              0,
              q.two.length + q.three.length - this._maxShortWords(q),
            ) +
          Math.max(0, q.clusterCells - this._maxClusterCells(q))
        );
      }

      // Problemstellen, die die Nachbearbeitung angeht, in dieser
      // Reihenfolge: zu große Blöcke, 2-Buchstaben-Wörter, 3-Buchstaben-
      // Wörter, 3x3-Cluster - jeweils nur, solange der Wert außerhalb des
      // Zielbereichs liegt.
      _getOptimizationTargets(q) {
        let targets = [];
        let addBlocks = (blocks, size) => {
          blocks.forEach((cells) => {
            targets.push({
              kind: "cluster",
              key: `cluster${size}:${cells[0].x},${cells[0].y}`,
              cells: cells,
              description: `Cluster ${size}x${size} bei (${cells[0].x},${cells[0].y})`,
            });
          });
        };
        let addWords = (words, label) => {
          words
            .filter((word) => !this._isFixedFirstWord(word))
            .sort((a, b) => a.y - b.y || a.x - b.x)
            .forEach((word) => {
              targets.push({
                kind: "short",
                key: this._wordKey(word),
                cells: this._wordCells(word),
                description: `${label} ${this._describeDummy(word)}`,
              });
            });
        };

        addBlocks(q.bigBlocks, q.bigSize);
        if (q.two.length > this._maxTwoLetterWords(q)) {
          addWords(q.two, "Wort mit 2 Buchstaben");
        }
        if (q.two.length + q.three.length > this._maxShortWords(q)) {
          addWords(q.three, "Wort mit 3 Buchstaben");
        }
        if (q.clusterCells > this._maxClusterCells(q)) {
          addBlocks(q.clusterBlocks, 3);
        }
        return targets;
      }

      _describeQuality(q) {
        let pct = (a, b) => (b ? Math.round((100 * a) / b) : 0) + " %";
        return (
          `2 Buchstaben ${pct(q.two.length, q.words)}, ` +
          `2-3 Buchstaben ${pct(q.two.length + q.three.length, q.words)}, ` +
          `Cluster ${pct(q.clusterCells, q.letters)}, ` +
          `Blöcke > ${q.bigSize - 1}x${q.bigSize - 1}: ${q.bigBlocks.length}`
        );
      }

      // Hinweisfeld und Buchstabenfelder eines Wortes
      _wordCells(word) {
        return [this.getField(word.x, word.y)].concat(this._wordFields(word));
      }

      // Anfangswort mit in den Settings vorgegebener Form (Länge > 0). Ein
      // zufälliges Anfangswort darf neu aufgebaut werden: Das Feld links
      // oben kann kein Buchstabe sein und wird daher immer wieder
      // Hinweisfeld.
      _isFixedFirstWord(word) {
        return (
          this.firstWordFixed &&
          word.x === this.firstWordField.x &&
          word.y === this.firstWordField.y
        );
      }

      _wordKey(word) {
        return `${word.x},${word.y},${word.direction},${word.length}`;
      }

      // Entfernt alle Wörter, deren Hinweisfeld oder Buchstaben im Rechteck
      // um die Felder des Ziels (erweitert um `radius`) liegen, und baut den
      // Bereich mit höchstens optimizeRefillSteps Suchschritten neu auf.
      // Bei kurzen Wörtern werden dabei lange Formen zuerst probiert.
      _refillRegion(target, radius, qualityBefore) {
        let snapshot = this._snapshotState();
        let savedStack = this.stack;
        let penaltyBefore = this._layoutPenalty(qualityBefore);

        let minX = Math.min(...target.cells.map((f) => f.x)) - radius;
        let maxX = Math.max(...target.cells.map((f) => f.x)) + radius;
        let minY = Math.min(...target.cells.map((f) => f.y)) - radius;
        let maxY = Math.max(...target.cells.map((f) => f.y)) + radius;
        let inRegion = (f) =>
          f.x >= minX && f.x <= maxX && f.y >= minY && f.y <= maxY;
        let region = this.dummys.filter(
          (d) => !this._isFixedFirstWord(d) && this._wordCells(d).some(inRegion),
        );

        region.forEach((d) => this.removeDummyFromGrid(d));
        this._markStructuralForcedFields();

        // Neuaufbau mit eigenem, leerem Stapel: Muss über den Ausgangszustand
        // hinaus zurückgegangen werden, ist der Versuch gescheitert
        this.stack = [];
        this.excluded = new Set();
        this.exhausted = false;
        this.preferLongWords = target.kind === "short";
        this.silent = true;
        let steps = 0;
        while (
          steps < this.optimizeRefillSteps &&
          !this.gridIsFinished() &&
          !this.exhausted
        ) {
          this._searchStep();
          steps++;
        }
        this.preferLongWords = false;
        this.silent = false;
        this.exhausted = false;

        let improved = false;
        if (this.gridIsFinished()) {
          let after = this._getLayoutQuality();
          improved =
            after.bigCells <= qualityBefore.bigCells &&
            this._layoutPenalty(after) < penaltyBefore;
        }
        if (improved) {
          this.stack = [];
        } else {
          this._restoreState(snapshot);
          this.stack = savedStack;
        }
        return {
          improved: improved,
          removed: region.length,
          steps: steps,
          box: { minX: minX, maxX: maxX, minY: minY, maxY: maxY },
        };
      }

      // ---- Reparaturen ----
      // Manche Konflikte lassen sich mit einem kleinen Umbau bestehender
      // Wörter lösen, statt per Backtracking zurückzugehen. Ein solcher Umbau
      // ist eine eigene Ebene im Stapel (kind "repair"), ihre Kandidaten sind
      // die möglichen Umbauten. Führt ein Umbau später in eine Sackgasse,
      // nimmt das Backtracking ihn zurück und probiert den nächsten. Sind alle
      // gescheitert, geht es darunter ganz normal weiter zurück.

      // Reparatur-Ebene für einen Konflikt, oder null, wenn es keinen
      // passenden Umbau gibt. Zuerst kommen die gezielten Umbauten für
      // Randfelder bzw. tote Pflicht-Hinweisfelder, danach das Umformen eines
      // beteiligten Wortes.
      _createRepairFrame(conflict) {
        if (!conflict.fields || conflict.type === "noPosition") {
          return null;
        }
        let field = conflict.fields[0];
        let candidates = [];
        if (conflict.type === "edges") {
          candidates = this._getEdgeRepairs(field);
        } else if (conflict.type === "deadField") {
          candidates = this._getMoveRepairs(field);
        }
        candidates = candidates.concat(this._getReshapeRepairs(conflict));
        if (candidates.length === 0) {
          return null;
        }
        return this._newFrame("repair", field, candidates);
      }

      // Wendet einen Umbau an. Liefert eine Beschreibung oder null, wenn er
      // nicht möglich ist (der Aufrufer stellt dann den Snapshot wieder her).
      // Ungültig ist ein Umbau auch, wenn er eine in diesem Zweig
      // ausgeschlossene Position zum Hinweisfeld macht, oder wenn er zu einem
      // Zustand führt, der auf dem aktuellen Pfad schon bestand - sonst
      // könnten sich zwei Umbauten endlos gegenseitig aufheben.
      _applyRepair(repair) {
        let detail;
        switch (repair.type) {
          case "edge":
            detail = this._applyEdgeRepair(repair);
            break;
          case "move":
            detail = this._moveClue(repair.word, repair.dead, repair.newLength);
            break;
          case "reshape":
            detail = this._applyReshapeRepair(repair);
            break;
        }
        if (!detail) {
          return null;
        }
        if ([...this.excluded].some((field) => field.isClue)) {
          return null;
        }
        let signature = this._stateSignature();
        if (this.stack.some((frame) => frame.signature === signature)) {
          return null;
        }
        this._markStructuralForcedFields();
        return detail;
      }

      // Kompakte Beschreibung des Zustands (Wörter und ausgeschlossene
      // Positionen), um Wiederholungen auf dem aktuellen Pfad zu erkennen
      _stateSignature() {
        let words = this.dummys
          .map((d) => `${d.x},${d.y},${d.direction},${d.length}`)
          .sort();
        let excluded = [...this.excluded].map((f) => `${f.x},${f.y}`).sort();
        return words.join(";") + "|" + excluded.join(";");
      }

      // Unbefüllbares Randfeld (siehe _validateEdges): Ein angrenzendes
      // Hinweisfeld wird aufgegeben und sein Wort, um 1 verlängert, vom
      // Randfeld aus gestartet. Kandidaten sind die beiden Nachbarn entlang
      // des Randes (links/rechts bzw. oben/unten), sofern ihr Wort quer zum
      // Rand verläuft.
      _getEdgeRepairs(field) {
        let repairs = [];
        if (this.excluded.has(field)) {
          return repairs;
        }
        let clueAt = (x, y) => {
          let f = this.getField(x, y);
          return f ? f.clueFor : null;
        };
        // Das Feld zwei weiter muss die alte Hinweisfeld-Position nach außen
        // abschließen: ein bestehendes Hinweisfeld, ein reserviertes Feld
        // oder der Grid-Rand erfüllen das gleichermaßen.
        let closedAt = (x, y) => {
          let f = this.getField(x, y);
          return f === null || f.isClueOrReserved;
        };
        let add = (word, wordDirection, closed, direction) => {
          if (
            word &&
            word.direction === wordDirection &&
            word.length < this.maxLength &&
            closed
          ) {
            repairs.push({ type: "edge", field, word, direction });
          }
        };

        let x = field.x,
          y = field.y;
        // Oberer Rand
        if (y === 0) {
          add(clueAt(x - 1, y), "down", closedAt(x - 2, y), "leftdown");
          add(clueAt(x + 1, y), "down", closedAt(x + 2, y), "rightdown");
        }
        // Linker Rand
        else {
          add(clueAt(x, y - 1), "right", closedAt(x, y - 2), "upright");
          add(clueAt(x, y + 1), "right", closedAt(x, y + 2), "downright");
        }
        return repairs;
      }

      _applyEdgeRepair(repair) {
        let before = this._describeDummy(repair.word);
        let length = repair.word.length + 1;
        this.removeDummyFromGrid(repair.word);
        let dummy = new Dummy(repair.field.x, repair.field.y, this);
        if (!dummy.shape(repair.direction, length)) {
          return null;
        }
        return `Wort ${before} ersetzt durch ${this._describeDummy(dummy)}`;
      }

      // Umformen: Ein Wort auf oder direkt neben einem Konfliktfeld behält sein
      // Hinweisfeld, bekommt aber eine andere Richtung/Länge. Kandidaten sind
      // alle dort möglichen anderen Formen der beteiligten Wörter - jüngste
      // Wörter zuerst, je Wort zuerst gleiche Richtung mit möglichst kleiner
      // Längenänderung, danach die übrigen Formen nach Bewertung. Formen, die
      // ein Wort neu auf 2-3 Buchstaben kürzen, kommen ganz ans Ende: Kürzen
      // schafft fast immer Platz und würde sonst zu sehr vielen kurzen
      // Wörtern führen.
      _getReshapeRepairs(conflict) {
        let fields = conflict.fields;
        let primary = `${conflict.type}:${fields[0].x},${fields[0].y}`;
        let words = new Set();
        let addFrom = (field) => {
          [field.clueFor, field.dummyHorizontal, field.dummyVertical].forEach(
            (dummy) => dummy && words.add(dummy),
          );
          field.forcedBy.forEach((dummy) => {
            if (dummy instanceof Dummy) {
              words.add(dummy);
            }
          });
        };
        fields.forEach((field) => {
          addFrom(field);
          field.getAdjacentFields().forEach(addFrom);
        });

        let ordered = [...words]
          .filter((word) => this.dummys.indexOf(word) !== -1)
          .sort((a, b) => this.dummys.indexOf(b) - this.dummys.indexOf(a));
        let problems = this._getProblemSet();
        let snapshot = this._snapshotState();
        let repairs = [];
        let shortRepairs = [];
        ordered.forEach((word) => {
          let direction = word.direction;
          let length = word.length;
          this.removeDummyFromGrid(word);
          let shapes = new Dummy(word.x, word.y, this).possibilities.filter(
            (p) => p.direction !== direction || p.length !== length,
          );
          this._restoreState(snapshot);

          let distance = (p) =>
            p.direction === direction ? Math.abs(p.length - length) : Infinity;
          // stabil sortiert: bei Gleichstand bleibt die Score-Reihenfolge
          shapes.sort((a, b) => {
            let da = distance(a);
            let db = distance(b);
            return da === db ? 0 : da < db ? -1 : 1;
          });
          shapes.forEach((p) => {
            let repair = {
              type: "reshape",
              word: word,
              direction: p.direction,
              length: p.length,
              problems: problems,
              primary: primary,
            };
            if (p.length <= 3 && length > 3) {
              shortRepairs.push(repair);
            } else {
              repairs.push(repair);
            }
          });
        });
        return repairs.concat(shortRepairs);
      }

      // Gilt nur, wenn danach weniger Probleme im Grid sind als vorher und
      // keines neu dazugekommen ist. So kann Umformen nie ein Problem nur an
      // eine andere Stelle schieben.
      _applyReshapeRepair(repair) {
        let before = this._describeDummy(repair.word);
        // Die Form wurde im exakt gleichen Zustand ermittelt (Snapshot der
        // Ebene), muss also nicht erneut geprüft werden
        this.removeDummyFromGrid(repair.word);
        repair.word.restoreShape(repair.direction, repair.length);
        let after = this._getProblemSet(repair.problems, repair.primary);
        if (after === null || after.size >= repair.problems.size) {
          return null;
        }
        return `Wort ${before} umgeformt zu "${repair.direction}" Länge ${repair.length}`;
      }

      // Alle aktuell offenen Probleme im Grid als Menge von Schlüsseln
      // ("Art:x,y"), zum Vergleich vor/nach einem Umbau. Mit `allowed` wird
      // abgebrochen und null geliefert, sobald ein Problem auftaucht, das
      // dort nicht enthalten ist, ebenso wenn das Problem `primary` (der
      // Konflikt, für den repariert wird) noch besteht. Diese Art wird
      // deshalb zuerst geprüft, die teuren Prüfungen am Ende.
      _getProblemSet(allowed, primary) {
        let keys = new Set();
        let checks = [
          ["excluded", () =>
            [...this.excluded].filter((f) => f.isEmpty && f.reserved)],
          ["cornerClue", () => this._getForbiddenForcedFields()],
          ["blocked", () => this._getBlockedFields()],
          ["edges", () => this._validateEdges()],
          ["constraints", () => this._getDirectionConstraints()],
        ];
        if (
          this.controller
            .getView()
            .getModel("settings")
            .getProperty("/adjClueLimitOn")
        ) {
          checks.push(["clueClumps", () => this._validateClueClumps().flat()]);
        }
        checks.push(["deadField", () => this._getDeadForcedFields()]);
        if (primary) {
          let primaryType = primary.split(":")[0];
          checks.sort((a, b) => (b[0] === primaryType) - (a[0] === primaryType));
        }

        for (const [type, getFields] of checks) {
          for (const field of getFields()) {
            let key = `${type}:${field.x},${field.y}`;
            if ((allowed && !allowed.has(key)) || key === primary) {
              return null;
            }
            keys.add(key);
          }
        }
        return keys;
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

      // Pflicht-Hinweisfeld ohne Möglichkeit: Ein bestehendes Wort wird so
      // verschoben und verlängert, dass das tote Feld zu seinem neuen
      // Hinweisfeld wird (siehe _moveClue). Gesucht wird vom toten Feld aus
      // nach rechts bzw. unten das erste Hinweisfeld; in Frage kommt es nur,
      // wenn sein Wort in derselben Linie verläuft ("right" bzw. "down") -
      // dann wird das alte Hinweisfeld zum Buchstaben des verlängerten Wortes.
      _getMoveRepairs(dead) {
        let repairs = [];
        [
          { stepX: 1, stepY: 0, direction: "right" },
          { stepX: 0, stepY: 1, direction: "down" },
        ].forEach((c) => {
          let clueField = this._findFirstClue(dead.x, dead.y, c.stepX, c.stepY);
          if (!clueField || clueField.clueFor.direction !== c.direction) {
            return;
          }
          let distance = c.stepX ? clueField.x - dead.x : clueField.y - dead.y;
          let newLength = clueField.clueFor.length + distance;
          if (newLength <= this.maxLength) {
            repairs.push({
              type: "move",
              word: clueField.clueFor,
              dead: dead,
              newLength: newLength,
            });
          }
        });
        return repairs;
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
        moved.shape(oldDirection, newLength);
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
        return {
          fields: fields,
          dummys: dummys,
          order: this.dummys.slice(),
          excluded: new Set(this.excluded),
        };
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
        this.excluded = new Set(snapshot.excluded);
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

      // Reine Berechnung, wird bei jeder Bewertung einer Wortform aufgerufen.
      // Die Anzeige im UI aktualisiert _publishAverageWordLength() einmal pro
      // Step: setProperty im Settings-Model prüft jedes Mal alle Bindings.
      _getCurrentAverageWordLength() {
        let totalLength = 0;
        for (let i = 0; i < this.dummys.length; i++) {
          totalLength += this.dummys[i].length;
        }
        return totalLength / this.dummys.length;
      }

      _publishAverageWordLength() {
        this.controller
          .getView()
          .getModel("settings")
          .setProperty(
            "/currentAverageWordLength",
            this._getCurrentAverageWordLength(),
          );
      }

      // Kennzahlen und Score jedes Feldes. Läuft nach jeder Änderung am Grid
      // und ist daher bewusst als ein einziger Durchlauf ohne Hilfslisten
      // geschrieben: die vier direkten Nachbarn werden je Feld nur einmal
      // betrachtet (gleiche Werte wie _getAdjEdges/_getAdjClues/
      // _getAdjBlocked/_getAdjLetters).
      _evaluateGrid() {
        let that = this;
        let grid = this.grid;
        let width = this.width;
        let height = this.height;
        grid.forEach(function (row) {
          row.forEach(function (field) {
            let x = field.x;
            let y = field.y;
            let edges =
              (x === 0 || x === width - 1 ? 1 : 0) +
              (y === 0 || y === height - 1 ? 1 : 0);
            let clues = 0;
            let blocked = 0;
            let letters = 0;
            let count = (neighbor) => {
              if (neighbor.isClue) {
                clues++;
                blocked++;
              } else if (neighbor.reserved) {
                blocked++;
              }
              if (neighbor.isLetter) {
                letters++;
              }
            };
            if (x > 0) count(row[x - 1]);
            if (x < width - 1) count(row[x + 1]);
            if (y > 0) count(grid[y - 1][x]);
            if (y < height - 1) count(grid[y + 1][x]);
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

      getRandomInt(min, max) {
        return this.random.int(min, max);
      }

      updateGrid() {
        this._evaluateGrid();
        this._publishAverageWordLength();
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
