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
      this.triedPossibilities = [];
      this._refreshPossibilities();
    }

    invalidate() {
      this.generator.removeDummyFromGrid(this);
      this.shaped = false;
      this.startX = null;
      this.startY = null;
      this.direction = null;
      this.horizontal = null;
      this.length = null;
      this._refreshPossibilities();
    }

    shape() {
      // Takes the best possibility and sets length/direction accordingly
      // TODO triedPossibilities nicht berücksichtigen
      let temp =
        this.possibilities[
          this.generator.getRandomInt(0, this.possibilities.length - 1)
        ];

      if (!temp) {
        console.log("No possibilities for: " + this);
        return;
      }

      this.triedPossibilities.push(temp);
      this.shaped = true;
      this.startX = this._getStartX(temp.direction);
      this.startY = this._getStartY(temp.direction);
      this.horizontal = this._getHorizontal(temp.direction);
      this.direction = temp.direction;
      this.length = temp.length;
      this.generator.addDummyToGrid(this);
    }

    _refreshPossibilities() {
      let directions = this._getValidDirections();
      let that = this;

      directions.forEach(function (direction) {
        let lengths = that._getValidLengths(direction);
        lengths.forEach(function (length) {
          that.possibilities.push({
            direction: direction,
            length: length,
          });
        });
      });
    }

    _getValidDirections() {
      let directions = this._getDirections();
      let validDirections = [];
      let that = this;

      directions.forEach(function (direction) {
        if (that._validateDirection(direction)) {
          validDirections.push(direction);
        }
      });
      return validDirections;
    }

    _getDirections() {
      let directions = [];
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
        directions.push("leftdown");
      }
      if (
        x < 11 &&
        grid[y][x + 1] &&
        !grid[y][x + 1].reserved &&
        (grid[y][x + 1].isEmpty || grid[y][x + 1].isLetter)
      ) {
        // field to the right
        directions.push("right");
        directions.push("rightdown");
      }
      if (
        y > 0 &&
        grid[y - 1][x] &&
        !grid[y - 1][x].reserved &&
        (grid[y - 1][x].isEmpty || grid[y - 1][x].isLetter)
      ) {
        // field above
        directions.push("upright");
      }
      if (
        y < 11 &&
        grid[y + 1][x] &&
        !grid[y + 1][x].reserved &&
        (grid[y + 1][x].isEmpty || grid[y + 1][x].isLetter)
      ) {
        // field below
        directions.push("down");
        directions.push("downright");
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
