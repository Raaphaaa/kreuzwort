sap.ui.define([], function () {
  "use strict";

  /** Dummy-Klasse
   * Jedes Dummy Objekt repräsentiert ein Feld, auf dem zukünftig der Hinweis für
   * ein Wort steht. Wenn der Dummy über shape() ausgeprägt wird, werden Richtung
   * und Länge des zugehörigen Wortes festgelegt.
   */
  return class Dummy {
    constructor(x, y, caller) {
      this.x = x;
      this.y = y;
      this.generator = caller;

      // Nur gesetzt wenn der Dummy wirklich ausgeprägt und aktiv ist.
      this.shaped = false;
      this.startX = null;
      this.startY = null;
      this.direction = null;
      this.horizontal = null;
      this.length = null;

      // Mögliche Platzierungen für das spätere Wort; enthält Objekte, welche Richtung
      // und Länge der möglichen Platzierung angeben
      this.possibilities = [];
      this.triedPossibilities = new Set();
      this._refreshPossibilities();
    }

    remove() {
      let field = this.generator.getField(this.x, this.y);
      this.generator.removeDummyFromGrid(this);
      field.forcedBy.forEach(function (dummy) {
        dummy.shape();
      });
    }

    shape(random = false, direction = null, length = null) {
      // Dummy entfernen, damit die eigenen Buchstaben und dadurch gesetzten Hinweisfelder
      // nicht die Berechnung der möglichen Wortlängen/Richtungen beeinflussen
      if (this.shaped) {
        this.generator.removeDummyFromGrid(this);
      }

      this._refreshPossibilities();
      // Takes the best possibility and sets length/direction accordingly
      if (this.possibilities.length == 0) {
        this.remove();
        return true;
      }

      let temp, i;
      if (random) {
        i = this.generator.getRandomInt(0, this.possibilities.length - 1);
        temp = this.possibilities[i];
      } else {
        if (direction && length) {
          for (i = 0; i < this.possibilities.length; i++) {
            if (
              this.possibilities[i].direction === direction &&
              this.possibilities[i].length === length
            ) {
              temp = this.possibilities[i];
              break;
            }
          }
        } else {
          temp = this.possibilities[0];
        }
      }

      this.triedPossibilities.add(this._getPossibilityKey(temp));
      this.startX = this._getStartX(temp.direction);
      this.startY = this._getStartY(temp.direction);
      this.horizontal = this._getHorizontal(temp.direction);
      this.direction = temp.direction;
      this.length = temp.length;

      if (this.shaped) {
        console.log(
          "Reshaped X:" +
            this.x +
            " Y:" +
            this.y +
            " ---> Direction: " +
            this.direction +
            " Length: " +
            this.length,
        );
      } else {
        console.log(
          "Shaped X:" +
            this.x +
            " Y:" +
            this.y +
            " - Direction: " +
            this.direction +
            " Length: " +
            this.length,
        );
      }
      this.shaped = true;
      this.generator.addDummyToGrid(this);
    }

    _refreshPossibilities() {
      let directions = this._getValidDirections();
      let that = this;
      this.possibilities = [];

      directions.forEach(function (direction) {
        let lengths = that._getValidLengths(direction);
        lengths.forEach(function (length) {
          that.possibilities.push({
            direction: direction,
            length: length,
            score: 0,
          });
        });
      });

      this.possibilities = this.possibilities.filter(function (possibility) {
        return !that.triedPossibilities.has(
          that._getPossibilityKey(possibility),
        );
      });

      if (this.possibilities.length == 0) {
        console.log("No possibilities for ", this);
        return;
      }

      this._evaluatePossibilities();
      this.possibilities.sort(function (a, b) {
        return b.score - a.score;
      });
    }

    _evaluatePossibilities() {
      // TODO: Länge danach bewerten, welche Hinweisfelder dadurch forciert werden.
      // Da auf Zeilen/Spalten gehen, wo x/y eine gerade Zahl ist und kleinen Bonus geben
      let that = this;
      for (let i = 0; i < that.possibilities.length; i++) {
        let possibility = that.possibilities[i];
        let x = that._getStartX(possibility.direction);
        let y = that._getStartY(possibility.direction);
        let moveX = that._getMoveX(possibility.direction);
        let moveY = that._getMoveY(possibility.direction);
        let diagonalClueBonus = 0;
        let reservedBonus = 0;
        let lengthBonus = 0;
        let directionBonus = 0;
        let parallelWordPenalty = 0;
        let score = 0;

        // Feldbewertungen
        for (let j = 0; j < possibility.length; j++) {
          score += that.generator.getEvaluation(x, y) / possibility.length;
          let field = that.generator.getField(x, y);
          if (field.isLetter) {
            score += 0.1;
          }

          // Beim letzten Feld nach angrenzenden Hinweisfeldern suchen. Hinweisfelder
          // sollten möglichst isoliert liegen und nicht nebeneinander. Daher ist es schlecht wenn das
          // Wort neben einem exitierenden Hinweisfeld endet.
          if (j === possibility.length - 1) {
            diagonalClueBonus = that.generator.getDiagonalClueBonus({
              x: x,
              y: y,
              horizontal: moveX > 0,
              startX: that._getStartX(possibility.direction),
              startY: that._getStartY(possibility.direction),
            });
            // Längere Wörter mit gutem Endpunkt sind besser für die Struktur des Rätsels
            diagonalClueBonus /=
              that.generator.getMaxLength() - (possibility.length - 1);

            // Die Wortlänge im nächsten Schleifendurchlauf ist min. 2 größer als die jetzige.
            // D.h. es existiert ein Buchstabenfeld zwischen der jetzigen und nächsten Wortlänge.
            // Dieses leere Feld eignet sich besonders gut für ein neues Hinweisfeld, daher Bonus geben
            if (
              that.possibilities[i + 1] &&
              that.possibilities[i + 1].direction === possibility.direction &&
              that.possibilities[i + 1].length - 1 != possibility.length
            ) {
              reservedBonus = 0.1;
            }
            // Bonus, falls das nächste Feld bereits ein Hinweisfeld ist.
            reservedBonus += that.generator.getReservedFieldBonus(
              x + moveX,
              y + moveY,
              possibility.length,
            );
          }
          x += moveX;
          y += moveY;
        }

        if (x % 2 == 0) {
          score += 0.1;
        }
        if (y % 2 == 0) {
          score += 0.1;
        }
        directionBonus = that.generator.getDirectionEvaluation(
          possibility.direction,
        );
        lengthBonus = that.generator.getLengthBonus(possibility.length);

        // Je weniger Hinweisfelder diagonal vom letzten Wortfeld liegen, desto
        // besser & weniger Möglichkeiten, dass Hinweisfelder direkt nebeneinander liegen.
        score += diagonalClueBonus;

        // Feld hinter dem Wort ist bereits als neues Hinweisfeld markiert oder schließt mit
        // dem Rand vom Feld ab. Daher kleinerr Bonus, damit keine Lücken entstehen und Wörter mit
        // dem Feldrand abschließen
        score *= reservedBonus;

        // Richtungsbewertung für standardmäßig horizontale und vertikale Wörter
        score *= directionBonus;

        // Längenbonus zur Vermeidung zu vieler kurzer/langer Wörter
        score *= lengthBonus;

        // Check, ob neben dem letzten Feld vom aktuellen Wort bereits ein anderes endet.
        // Schlecht für die Struktur des Rätsels, wenn Wörter direkt nebeneinander enden, da
        // dann auch Hinweisfelder zwangsweise direkt nebeneinander liegen.
        // Wird ignoriert, wenn das nächste Feld bereits als Hinweisfeld markiert ist
        if (reservedBonus <= 1) {
          parallelWordPenalty = that.generator.getParallelWordScore(
            x - moveX,
            y - moveY,
            possibility.direction,
          );

          score *= parallelWordPenalty;
        }
        that.possibilities[i].score = parseFloat(score.toFixed(2));
      }
    }

    _getPossibilityKey(possibility) {
      return possibility.direction + ":" + possibility.length;
    }

    _getValidDirections() {
      let directions = this._getDirections();
      let validDirections = new Set();
      let that = this;

      directions.forEach(function (direction) {
        if (that._validateDirection(direction)) {
          validDirections.add(direction);
        }
      });
      return validDirections;
    }

    _getDirections() {
      let directions = new Set();
      const grid = this.generator.getGrid();
      let x = this.x;
      let y = this.y;
      if (
        x > 0 &&
        grid[y][x - 1] &&
        !grid[y][x - 1].reserved &&
        (grid[y][x - 1].isEmpty || grid[y][x - 1].isLetter)
      ) {
        // field to the left
        directions.add("leftdown");
      }
      if (
        x < this.generator.width - 1 &&
        grid[y][x + 1] &&
        !grid[y][x + 1].reserved &&
        (grid[y][x + 1].isEmpty || grid[y][x + 1].isLetter)
      ) {
        // field to the right
        directions.add("right");
        if (y != 1) {
          directions.add("rightdown");
        }
      }
      if (
        y > 0 &&
        grid[y - 1][x] &&
        !grid[y - 1][x].reserved &&
        (grid[y - 1][x].isEmpty || grid[y - 1][x].isLetter)
      ) {
        // field above

        directions.add("upright");
      }
      if (
        y < this.generator.height - 1 &&
        grid[y + 1][x] &&
        !grid[y + 1][x].reserved &&
        (grid[y + 1][x].isEmpty || grid[y + 1][x].isLetter)
      ) {
        // field below
        directions.add("down");

        if (x != 1) {
          directions.add("downright");
        }
      }
      return directions;
    }

    _validateDirection(direction) {
      const grid = this.generator.getGrid();

      let x = this._getStartX(direction);
      let y = this._getStartY(direction);
      let moveX = this._getMoveX(direction);
      let moveY = this._getMoveY(direction);
      let horizontal = this._getHorizontal(direction);

      // check the field in front of the word. If it is a letter,
      // starting a word at the current position is invalid
      let previousX = x - moveX;
      let previousY = y - moveY;
      if (
        grid[previousY] &&
        grid[previousY][previousX] &&
        !grid[previousY][previousX].isEmpty &&
        grid[previousY][previousX].isLetter
      ) {
        return false;
      }

      // word would be placed parallel and directly at the top or left edge. This would block crucial
      // fields for clues of future words
      if ((x == 0 && moveY > 0) || (y == 0 && moveX > 0)) {
        return false;
      }

      // check for an existing word in the same direction
      if (
        (horizontal && grid[y][x].dummyHorizontal != null) ||
        (!horizontal && grid[y][x].dummyVertical != null)
      ) {
        return false;
      }

      return true;
    }

    _getValidLengths(direction) {
      const grid = this.generator.getGrid();
      let that = this;
      let width = this.generator.width;
      let height = this.generator.height;

      let validLengths = [];
      let length = 2;
      let x = this._getStartX(direction);
      let y = this._getStartY(direction);
      let moveX = this._getMoveX(direction);
      let moveY = this._getMoveY(direction);
      while (length <= this.generator.getMaxLength()) {
        x += moveX;
        y += moveY;
        // exceeding the gird or the field is reserved for a new clue
        if (x >= width || y >= height || grid[y][x].reserved) {
          break;
        }

        let currentField = grid[y][x];

        if (!that.generator.checkConstraintsForLetter(x, y, direction)) {
          break;
        }

        // continue when the current field is empty or a letter
        if (currentField.isEmpty || currentField.isLetter) {
          // check, if the next field would be within the grid. IF so, that
          // field has to be checked as well
          if (x + moveX < width && y + moveY < height) {
            let nextField = grid[y + moveY][x + moveX];
            // only if the next field is empty or a clue, a word can be placed up to the
            // current field without issues. If it would be a letter(x), the word ending right
            // in front of it would be invalid:
            // | | | | | |
            // |W|O|R|D|x|
            // | | | | | |
            if (nextField.isEmpty || (!nextField.isEmpty && nextField.isClue)) {
              validLengths.push(length);
            }
          } else {
            validLengths.push(length);
            break;
          }
        }
        length++;
      }
      return validLengths;
    }

    _getStartX(direction) {
      switch (direction) {
        case "right":
        case "rightdown":
          return this.x + 1;
        case "leftdown":
          return this.x - 1;
        default:
          return this.x;
      }
    }

    _getStartY(direction) {
      switch (direction) {
        case "upright":
          return this.y - 1;
        case "down":
        case "downright":
          return this.y + 1;
        default:
          return this.y;
      }
    }

    _getHorizontal(direction) {
      // returns true if the word would be placed horizontally, false if it would be placed vertically
      switch (direction) {
        case "downright":
        case "upright":
        case "right":
          return true;
        default:
          return false;
      }
    }

    _getMoveX(direction) {
      switch (direction) {
        case "right":
        case "downright":
        case "upright":
          return 1;
        default:
          return 0;
      }
    }

    _getMoveY(direction) {
      switch (direction) {
        case "down":
        case "rightdown":
        case "leftdown":
          return 1;
        default:
          return 0;
      }
    }
  };
});
