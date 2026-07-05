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
        return this.grid[y][x];
      }

      step() {
        let that = this,
          location,
          dummy,
          forcedLocations = this._getForcedDummyLocations(),
          optionalLocations = this._getOptionalDummyLocations();

        if (forcedLocations.length > 0) {
          location = forcedLocations[0];
        } else if (optionalLocations.length > 0) {
          location = optionalLocations[0];
        } else {
          console.log("NO MARKED LOCATIONS LEFT");
          return;
        }
        dummy = new Dummy(location.x, location.y, that);
        dummy.shape();

        console.log(this.getScore());
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

      getLengthBonus(length) {
        return this.controller
          .getView()
          .getModel("weights")
          .getProperty(`/lengthBonus/${length}`);
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
            score += clues * 0.5;
            score += edges * 0.3;
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

        x = x > 5 ? 5 : x;
        y = y > 5 ? 5 : y;

        let dummy = new Dummy(x, y, this);
        dummy.shape();
      }

      getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }

      removeLastWord() {
        this.removeDummyFromGrid(this.dummys[this.dummys.length - 1]);
      }

      addDummyToGrid(dummy) {
        this.dummys.push(dummy);
        this._addDummyLetters(dummy);
        this._markForcedWordLocations(dummy);
        this._markOptionalWordLocations(dummy);
        this._evaluateGrid();
        this.controller.setGrid(this.getGrid());
        console.log("Added ", dummy);
      }

      _addDummyLetters(dummy) {
        this.grid[dummy.y][dummy.x].isEmpty = false;
        this.grid[dummy.y][dummy.x].isLetter = false;
        this.grid[dummy.y][dummy.x].isClue = true;

        // fields for the letters of the word
        for (let j = 0; j < dummy.length; j++) {
          let x = dummy.startX + (dummy.horizontal ? j : 0);
          let y = dummy.startY + (dummy.horizontal ? 0 : j);
          let field = this.grid[y][x];
          field.isEmpty = false;
          field.isLetter = true;

          if (dummy.horizontal) {
            field.dummyHorizontal = dummy;
          } else {
            field.dummyVertical = dummy;
          }
          // TODO Oberserver Pattern für invalidate später

          if (dummy.horizontal) {
            field.hasHorizontalWord = true;
          } else {
            field.hasVerticalWord = true;
          }

          this.grid[y][x] = field;
        }

        // field directly to the right and below the clue field
        if (
          this.grid[dummy.y][dummy.x + 1] &&
          !this.grid[dummy.y][dummy.x + 1].isClue
        ) {
          this.grid[dummy.y][dummy.x + 1].hasHorizontalWord = true;
        }
        if (
          this.grid[dummy.y + 1] &&
          this.grid[dummy.y + 1][dummy.x] &&
          !this.grid[dummy.y + 1][dummy.x].isClue
        ) {
          this.grid[dummy.y + 1][dummy.x].hasVerticalWord = true;
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
                that.grid[dummy.y + 2][dummy.x].reserved = true;
                that.grid[dummy.y + 2][dummy.x].forcedBy.add(dummy);
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
            }
          }
          if (that.grid[dummy.startY][dummy.startX - 1]) {
            // | | | | | |
            // |#|W|O|R|D|
            // | | | | | |
            that.grid[dummy.startY][dummy.startX - 1].nextWordLocation = true;
            that.grid[dummy.startY][dummy.startX - 1].reserved = true;
            that.grid[dummy.startY][dummy.startX - 1].forcedBy.add(dummy);

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
            }
          }
        } else {
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
              }
            } else {
              if (
                that.grid[dummy.y][dummy.x + 2] &&
                that.grid[dummy.y][dummy.x + 2].isEmpty
              ) {
                that.grid[dummy.y][dummy.x + 2].nextWordLocation = true;
                that.grid[dummy.y][dummy.x + 2].reserved = true;
                that.grid[dummy.y][dummy.x + 2].forcedBy.add(dummy);
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
            if (
              dummy.startX == 1 &&
              that.grid[dummy.startY + dummy.length][0].isEmpty
            ) {
              that.grid[dummy.startY + dummy.length][0].nextWordLocation = true;
              that.grid[dummy.startY + dummy.length][0].reserved = true;
              that.grid[dummy.startY + dummy.length][0].forcedBy.add(dummy);
            }
          }
          if (that.grid[dummy.startY - 1]) {
            that.grid[dummy.startY - 1][dummy.startX].nextWordLocation = true;
            that.grid[dummy.startY - 1][dummy.startX].reserved = true;
            that.grid[dummy.startY - 1][dummy.startX].forcedBy.add(dummy);

            if (dummy.startX == 1 && that.grid[dummy.startY - 1][0].isEmpty) {
              that.grid[dummy.startY - 1][0].nextWordLocation = true;
              that.grid[dummy.startY - 1][0].reserved = true;
              that.grid[dummy.startY - 1][0].forcedBy.add(dummy);
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
            that.grid[dummy.y][dummy.x + 2].reserved = false;
            that.grid[dummy.y][dummy.x + 2].markedBy.add(dummy);
          }
        } else {
          if (
            that.grid[dummy.y + 2] &&
            that.grid[dummy.y + 2][dummy.x] &&
            that.grid[dummy.y + 2][dummy.x].isEmpty
          ) {
            that.grid[dummy.y + 2][dummy.x].nextWordLocation = true;
            that.grid[dummy.y + 2][dummy.x].reserved = false;
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
        this._evaluateGrid();
        this.controller.setGrid(this.getGrid());
        console.log("Removed ", dummy);
      }

      _removeDummyLetters(dummy) {
        // clue field
        this.grid[dummy.y][dummy.x].isEmpty = true;
        this.grid[dummy.y][dummy.x].isLetter = false;
        this.grid[dummy.y][dummy.x].isClue = false;

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
          } else {
            field.dummyVertical = null;
          }

          if (dummy.horizontal) {
            field.hasHorizontalWord = false;
          } else {
            field.hasVerticalWord = false;
          }

          this.grid[y][x] = field;
        }

        // field directly to the right and below the clue field
        if (
          this.grid[dummy.y][dummy.x + 1] &&
          !this.grid[dummy.y][dummy.x + 1].isClue
        ) {
          this.grid[dummy.y][dummy.x + 1].hasHorizontalWord = false;
        }
        if (
          this.grid[dummy.y + 1] &&
          this.grid[dummy.y + 1][dummy.x] &&
          !this.grid[dummy.y + 1][dummy.x].isClue
        ) {
          this.grid[dummy.y + 1][dummy.x].hasVerticalWord = false;
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
      }
    };
  },
);
