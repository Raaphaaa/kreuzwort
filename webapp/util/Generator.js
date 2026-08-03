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
        this.resetGrid();
        this._shapeFirstDummy();
        this.controller.setGrid(this.getGrid());
      }

      getField(x, y) {
        if (x < this.width && y < this.height) {
          return this.grid[y][x];
        }
      }

      getLastDummy() {
        return this.dummys[this.dummys.length - 1];
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
                that.grid[y][x].nextWordLocation = true;
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

        this._validateGrid();

        // Markieren von neuen Felder als forcierte Hinweisfelder. Kann dadurch entstehen,
        // dass aufeinanderfolgende Buchstaben nur noch auf ein einziges verbleibendes Feld zeigen
        this._markNewForcedFields();

        this.updateGrid();
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
          if (this.getLastDummy().shape()) {
            console.log("Last dummy has no possibilities left");
          }
          this._validateGrid();
        } else {
          console.log("OK letters");
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
            this.getLastDummy().shape();
            this._validateGrid();
          } else {
            console.log("OK clues");
          }
        }

        let impossibleEdges = this._validateEdges();
        if (impossibleEdges.length > 0) {
          console.log("IMPOSSIBLE EDGES FOUND: ", impossibleEdges);
          // 1.Versuch: Konstellation fixen
          if (!this._fixEdges(impossibleEdges)) {
            // 2. Versuch: den Dummy, der die Konstellation verursacht neu generieren
            this.getLastDummy().shape();
          }
          this._validateGrid();
        } else {
          console.log("OK edges");
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

      _markNewForcedFields() {
        // Nachdem das Grid validiert wurde, wird nach Positionen gesucht, die durch das
        // neu hinzugefügte Wort zu forcierten Hinweisfeldern werden.

        // TODO: Wichtig: Die müssen irgendwie wieder entfernt werden bei jedem Cycle
        let that = this;
        let forcedFields = this._getForcedFields();
        forcedFields.forEach(function (field) {
          that.grid[field.y][field.x].nextWordLocation = true;
          that.grid[field.y][field.x].reserved = true;
        });
        if (forcedFields.length > 0) {
          console.log("Updated fields to FORCED", forcedFields);
          // TODO diese Felder wieder resetten
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
            !above.reserved
          ) {
            if (!forcedFieldKeys.has(above.x + "," + above.y + ",horizontal")) {
              return false;
            }
          }

          if (
            below &&
            !below.isClue &&
            below.nextWordLocation &&
            !below.reserved
          ) {
            if (!forcedFieldKeys.has(below.x + "," + below.y + ",horizontal")) {
              return false;
            }
          }
        } else {
          if (field.x > 0) {
            left = this.grid[field.y][field.x - 1];
          }
          if (field.x < this.width - 1) {
            right = this.grid[field.y][field.x + 1];
          }

          if (left && left.nextWordLocation && !left.reserved) {
            if (!forcedFieldKeys.has(left.x + "," + left.y + ",vertical")) {
              return false;
            }
          }

          if (right && right.nextWordLocation && !right.reserved) {
            if (!forcedFieldKeys.has(right.x + "," + right.y + ",vertical")) {
              return false;
            }
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

          if (
            current.isEmpty &&
            !current.nextWordLocation &&
            !current.reserved
          ) {
            candidate = null;
            break;
          }
          // Feld bereits als forciert hinterlegt
          if (current.isEmpty && current.reserved) {
            candidate = null;
            break;
          }
          // Mögliches Hinweisfeld gefunden. Es kann sein, dass dieses dann später als forciertes
          // Feld hinterlegt wird. Es besteht aber auch die Möglichkeit, dass hinter dem gefundenen
          // Hinweisfeld ein weiteres liegt. Dann gibt es min. 2 Möglichkeiten für ein Wort
          // in dieser Richtung --> kann ignoriert werden.
          if (
            current.isEmpty &&
            current.nextWordLocation &&
            !current.reserved
          ) {
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

      getDirectionEvaluation(direction) {
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
            return 1;
          }
          // Feld rechts vom aktuellen Feld
          if (x < this.width - 1) {
            // let right = this.grid[y][x + 1];
            // if (
            //   right.dummyVertical &&
            //   right.dummyVertical.startY + right.dummyVertical.length - 1 == y
            // ) {
            //   adjWordEndings += 1;
            // }
            let right = this.grid[y + 1][x + 1];
            if (right.reserved) {
              adjWordEndings += 1;
            }
          }
          // Feld links vom aktuellen Feld
          if (x > 0) {
            // let left = this.grid[y][x - 1];
            // if (
            //   left.dummyVertical &&
            //   left.dummyVertical.startY + left.dummyVertical.length - 1 == y
            // ) {
            //   adjWordEndings += 1;
            // }
            let left = this.grid[y + 1][x - 1];
            if (left.reserved) {
              adjWordEndings += 1;
            }
          }
        }
        // horizontales Wort
        else {
          if (x == this.width - 1) {
            return 1;
          }
          // Feld unter dem aktuellen Feld
          if (y < this.height - 1) {
            // let below = this.grid[y + 1][x];
            // if (
            //   below.dummyHorizontal &&
            //   below.dummyHorizontal.startX + below.dummyHorizontal.length - 1 ==
            //     x
            // ) {
            //   adjWordEndings += 1;
            // }
            let below = this.grid[y + 1][x + 1];
            if (below.reserved) {
              adjWordEndings += 1;
            }
          }
          // Feld über dem aktuellen Feld
          if (y > 0) {
            // let above = this.grid[y - 1][x];
            // if (
            //   above.dummyHorizontal &&
            //   above.dummyHorizontal.startX + above.dummyHorizontal.length - 1 ==
            //     x
            // ) {
            //   adjWordEndings += 1;
            // }
            let above = this.grid[y - 1][x];
            if (above.reserved) {
              adjWordEndings += 1;
            }
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
              bonus += 1;
            } else if (topleft.nextWordLocation) {
              bonus += 0.5;
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
        let x = this.controller
          .getView()
          .getModel("settings")
          .getProperty("/firstWordX");
        let y = this.controller
          .getView()
          .getModel("settings")
          .getProperty("/firstWordY");

        let length = this.controller
          .getView()
          .getModel("settings")
          .getProperty("/firstWordLength");
        let direction = this.controller
          .getView()
          .getModel("settings")
          .getProperty("/firstWordDirection");

        x = x > 5 ? 5 : x;
        y = y > 5 ? 5 : y;

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
        this.updateGrid();
        // console.log("Added ", dummy);
      }

      _addDummyLetters(dummy) {
        let that = this;
        this.grid[dummy.y][dummy.x].isEmpty = false;
        this.grid[dummy.y][dummy.x].isLetter = false;
        this.grid[dummy.y][dummy.x].isClue = true;
        this.grid[dummy.y][dummy.x].clueFor = dummy;

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          let field = this.grid[y][x];
          field.isEmpty = false;
          field.isLetter = true;

          if (dummy.horizontal) {
            field.hasHorizontalWord = true;
            field.dummyHorizontal = dummy;
            if (
              that.grid[y - 1] &&
              that.grid[y - 1][x].isClue &&
              that.grid[y + 1] &&
              that.grid[y + 1][x].isEmpty
            ) {
              that.grid[y + 1][x].reserved = true;
              that.grid[y + 1][x].nextWordLocation = true;
              that.grid[y + 1][x].forcedBy.add(dummy);
              that.grid[y + 1][x].markedBy.add(dummy);
            }
          } else {
            field.hasVerticalWord = true;
            field.dummyVertical = dummy;
            if (
              that.grid[y][x - 1] &&
              that.grid[y][x - 1].isClue &&
              that.grid[y][x + 1] &&
              that.grid[y][x + 1].isEmpty
            ) {
              that.grid[y][x + 1].reserved = true;
              that.grid[y][x + 1].nextWordLocation = true;
              that.grid[y][x + 1].forcedBy.add(dummy);
              that.grid[y][x + 1].markedBy.add(dummy);
            }
          }

          this.grid[y][x] = field;
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
        let aLocations = [];
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
                that.grid[dummy.y - 2][dummy.x].nextWordLocation = true;
                that.grid[dummy.y - 2][dummy.x].reserved = true;
                that.grid[dummy.y - 2][dummy.x].forcedBy.add(dummy);
                that.grid[dummy.y - 2][dummy.x].markedBy.add(dummy);
              }
            } else {
              // |C| | | |
              // |W|O|R|D|
              // |#| | | |
              if (
                that.grid[dummy.y + 2] &&
                that.grid[dummy.y + 2][dummy.x].isEmpty
              ) {
                that.grid[dummy.y + 2][dummy.x].nextWordLocation = true;
                that.grid[dummy.y + 2][dummy.x].reserved = true; // experimentell TODO:evtl. false setzen
                that.grid[dummy.y + 2][dummy.x].forcedBy.add(dummy);
                that.grid[dummy.y + 2][dummy.x].markedBy.add(dummy);
              }
            }
          }

          if (that.grid[dummy.startY][dummy.startX + dummy.length]) {
            // Field behind the word is always a marker
            // | | | | | |
            // |W|O|R|D|#|
            // | | | | | |
            that.grid[dummy.startY][
              dummy.startX + dummy.length
            ].nextWordLocation = true;
            that.grid[dummy.startY][dummy.startX + dummy.length].reserved =
              true;
            that.grid[dummy.startY][dummy.startX + dummy.length].forcedBy.add(
              dummy,
            );
            that.grid[dummy.startY][dummy.startX + dummy.length].markedBy.add(
              dummy,
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
              that.grid[0][dummy.startX + dummy.length].nextWordLocation = true;
              that.grid[0][dummy.startX + dummy.length].reserved = true;
              that.grid[0][dummy.startX + dummy.length].forcedBy.add(dummy);
              that.grid[0][dummy.startX + dummy.length].markedBy.add(dummy);
            }
          }
          if (that.grid[dummy.startY][dummy.startX - 1]) {
            // | | | | | |
            // |#|W|O|R|D|
            // | | | | | |

            // Feld vor dem Wort als Pflichtfeld markieren, wenn das Hinweisfeld darüber/darunter in
            // der Zeile liegt
            if (dummy.startY != dummy.y) {
              that.grid[dummy.startY][dummy.startX - 1].nextWordLocation = true;
              that.grid[dummy.startY][dummy.startX - 1].reserved = true;
              that.grid[dummy.startY][dummy.startX - 1].forcedBy.add(dummy);
              that.grid[dummy.startY][dummy.startX - 1].markedBy.add(dummy);
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
              that.grid[0][dummy.startX - 1].nextWordLocation = true;
              that.grid[0][dummy.startX - 1].reserved = true;
              that.grid[0][dummy.startX - 1].forcedBy.add(dummy);
              that.grid[0][dummy.startX - 1].markedBy.add(dummy);
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
                that.grid[dummy.y + 2][dummy.x].nextWordLocation = true;
                that.grid[dummy.y + 2][dummy.x].reserved = true;
                that.grid[dummy.y + 2][dummy.x].forcedBy.add(dummy);
                that.grid[dummy.y + 2][dummy.x].markedBy.add(dummy);
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
                that.grid[dummy.y][dummy.x - 2].nextWordLocation = true;
                that.grid[dummy.y][dummy.x - 2].reserved = true;
                that.grid[dummy.y][dummy.x - 2].forcedBy.add(dummy);
                that.grid[dummy.y][dummy.x - 2].markedBy.add(dummy);
              }
            } else {
              if (
                that.grid[dummy.y][dummy.x + 2] &&
                that.grid[dummy.y][dummy.x + 2].isEmpty
              ) {
                that.grid[dummy.y][dummy.x + 2].nextWordLocation = true;
                that.grid[dummy.y][dummy.x + 2].reserved = true; // experimentell TODO:evtl. false setzen
                that.grid[dummy.y][dummy.x + 2].forcedBy.add(dummy);
                that.grid[dummy.y][dummy.x + 2].markedBy.add(dummy);
              }
            }
          }
          if (that.grid[dummy.startY + dummy.length]) {
            that.grid[dummy.startY + dummy.length][
              dummy.startX
            ].nextWordLocation = true;
            that.grid[dummy.startY + dummy.length][dummy.startX].reserved =
              true;
            that.grid[dummy.startY + dummy.length][dummy.startX].forcedBy.add(
              dummy,
            );
            that.grid[dummy.startY + dummy.length][dummy.startX].markedBy.add(
              dummy,
            );
            if (
              dummy.startX == 1 &&
              that.grid[dummy.startY + dummy.length][0].isEmpty
            ) {
              that.grid[dummy.startY + dummy.length][0].nextWordLocation = true;
              that.grid[dummy.startY + dummy.length][0].reserved = true;
              that.grid[dummy.startY + dummy.length][0].forcedBy.add(dummy);
              that.grid[dummy.startY + dummy.length][0].markedBy.add(dummy);
            }
          }

          if (that.grid[dummy.startY - 1]) {
            if (dummy.startX != dummy.x) {
              that.grid[dummy.startY - 1][dummy.startX].nextWordLocation = true;
              that.grid[dummy.startY - 1][dummy.startX].reserved = true;
              that.grid[dummy.startY - 1][dummy.startX].forcedBy.add(dummy);
              that.grid[dummy.startY - 1][dummy.startX].markedBy.add(dummy);
            }

            if (dummy.startX == 1 && that.grid[dummy.startY - 1][0].isEmpty) {
              that.grid[dummy.startY - 1][0].nextWordLocation = true;
              that.grid[dummy.startY - 1][0].reserved = true;
              that.grid[dummy.startY - 1][0].forcedBy.add(dummy);
              that.grid[dummy.startY - 1][0].markedBy.add(dummy);
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
                that.grid[dummy.y][dummy.x + 2].nextWordLocation = true;
                that.grid[dummy.y][dummy.x + 2].reserved = true;
                that.grid[dummy.y][dummy.x + 2].forcedBy.add(dummy);
                that.grid[dummy.y][dummy.x + 2].markedBy.add(dummy);
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
            that.grid[dummy.y][dummy.x + 2].nextWordLocation = true;
            // that.grid[dummy.y][dummy.x + 2].reserved = false;
            that.grid[dummy.y][dummy.x + 2].markedBy.add(dummy);
          }
        } else {
          if (
            that.grid[dummy.y + 2] &&
            that.grid[dummy.y + 2][dummy.x] &&
            that.grid[dummy.y + 2][dummy.x].isEmpty
          ) {
            that.grid[dummy.y + 2][dummy.x].nextWordLocation = true;
            // that.grid[dummy.y + 2][dummy.x].reserved = false;
            that.grid[dummy.y + 2][dummy.x].markedBy.add(dummy);
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
              that.grid[minY][x].nextWordLocation = true;
              that.grid[minY][x].reserved = false;
              that.grid[minY][x].markedBy.add(dummy);
              if (x == 1 && that.grid[minY][0].isEmpty) {
                that.grid[minY][0].nextWordLocation = true;
                that.grid[minY][0].reserved = true;
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
              that.grid[y][minX].nextWordLocation = true;
              that.grid[y][minX].reserved = false;
              that.grid[y][minX].markedBy.add(dummy);
              if (y == 1 && that.grid[0][minX].isEmpty) {
                that.grid[0][minX].nextWordLocation = true;
                that.grid[0][minX].reserved = true;
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
        this.updateGrid();
        // console.log("Removed ", dummy);
      }

      _removeDummyLetters(dummy) {
        // clue field
        this.grid[dummy.y][dummy.x].isEmpty = true;
        this.grid[dummy.y][dummy.x].isLetter = false;
        this.grid[dummy.y][dummy.x].isClue = false;
        this.grid[dummy.y][dummy.x].clueFor = null;

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          let field = this.grid[y][x];

          if (
            (dummy.horizontal && !field.hasVerticalWord) ||
            (!dummy.horizontal && !field.hasHorizontalWord)
          ) {
            field.isEmpty = true;
            field.isLetter = false;
          }

          if (dummy.horizontal) {
            field.dummyHorizontal = null;
            field.hasHorizontalWord = false;
          } else {
            field.dummyVertical = null;
            field.hasVerticalWord = false;
          }

          this.grid[y][x] = field;
        }
      }

      _unmarkNextWordLocations(dummy) {
        let that = this;
        this.grid.forEach(function (row) {
          row.forEach(function (field) {
            // Entfernen aller forcierten Marker
            if (field.forcedBy.delete(dummy) && field.forcedBy.size == 0) {
              if (field.markedBy.size == 0) {
                field.nextWordLocation = false;
              }
              field.reserved = false;
            }

            // Entfernen aller optionalen Marker
            if (field.markedBy.delete(dummy) && field.markedBy.size == 0) {
              field.nextWordLocation = false;
            }

            that.grid[field.y][field.x] = field;
          });
        });
        this._markNewForcedFields();
      }
    };
  },
);
