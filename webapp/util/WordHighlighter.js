sap.ui.define([], function () {
  "use strict";

  /** WordHighlighter-Klasse
   * Verwaltet den Fokus- und Highlighting-Zustand des Grids: welches Feld
   * aktuell angeklickt ist (focused) und welches Wort inkl. zugehörigem
   * Hinweisfeld dazu hervorgehoben wird (highlighted).
   */
  return class WordHighlighter {
    constructor(controllerRef) {
      this.controller = controllerRef;
      this.focusedCell = null;
      this.highlightedWord = null;
      this.highlightedCells = [];
    }

    _getGrid() {
      return this.controller.gridGenerator.getGrid();
    }

    reset() {
      this.focusedCell = null;
      this.highlightedWord = null;
      this.highlightedCells = [];
      this.hideCurrentWord();
    }

    highlight(x, y) {
      let grid = this._getGrid();
      x = parseInt(x, 10);
      y = parseInt(y, 10);
      let field = grid[y] && grid[y][x];
      if (!field) {
        return;
      }

      // Für den Kreuzungsfall (Feld gehört zu horizontalem UND vertikalem
      // Wort) merken, welche Richtung zuletzt gewählt war, bevor der State
      // zurückgesetzt wird - wird für den Toggle bei erneutem Klick auf
      // dasselbe Feld gebraucht.
      let sameCellAsBefore =
        this.focusedCell != null &&
        this.focusedCell.x === x &&
        this.focusedCell.y === y;
      let previousWordWasHorizontal = this.highlightedWord
        ? this.highlightedWord.horizontal
        : null;
      // Nutzer klickt auf ein Feld im gleichen Wort, daher das markierte Wort nicht wechseln
      let staysOnCurrentWord =
        !sameCellAsBefore && this.highlightedCells.indexOf(field) !== -1;
      let currentWord = this.highlightedWord;

      this._clearHighlightedWord();

      // Bei Hinweisfeldern den ersten Buchstaben des Wortes fokussieren
      if (field.isClue) {
        this._setFocusedCell(field.clueFor.startX, field.clueFor.startY);
      } else {
        this._setFocusedCell(x, y);
      }

      let dummy = staysOnCurrentWord
        ? currentWord
        : this._selectWordForField(
            field,
            sameCellAsBefore,
            previousWordWasHorizontal,
          );
      if (dummy) {
        this._highlightWord(dummy);
      }

      this.controller.setGrid(this.controller.gridGenerator.getGrid());
    }

    // Wählt aus, welches Wort für ein angeklicktes Feld hervorgehoben werden
    // soll. Liegt das Feld an einer Kreuzung (Teil von horizontalem UND
    // vertikalem Wort), wird per Prozentangabe ermittelt, in welchem Wort
    // der Buchstabe weiter am Anfang steht - bei Gleichstand gewinnt das
    // vertikale Wort. Wird dasselbe Feld erneut angeklickt, wird stattdessen
    // zur jeweils anderen Richtung gewechselt.
    _selectWordForField(field, sameCellAsBefore, previousWordWasHorizontal) {
      let horizontalDummy = field.dummyHorizontal;
      let verticalDummy = field.dummyVertical;

      if (horizontalDummy && verticalDummy) {
        if (sameCellAsBefore && previousWordWasHorizontal != null) {
          return previousWordWasHorizontal ? verticalDummy : horizontalDummy;
        }

        let horizontalPercent = this._getWordPositionPercent(
          field,
          horizontalDummy,
        );
        let verticalPercent = this._getWordPositionPercent(
          field,
          verticalDummy,
        );

        return verticalPercent <= horizontalPercent
          ? verticalDummy
          : horizontalDummy;
      }

      return horizontalDummy || verticalDummy || field.clueFor || null;
    }

    // Gibt zurück, wie weit vorne (0 = Wortanfang, 1 = Wortende) sich das
    // Feld innerhalb des gegebenen Wortes befindet.
    _getWordPositionPercent(field, dummy) {
      if (dummy.length <= 1) {
        return 0;
      }
      let position = dummy.horizontal
        ? field.x - dummy.startX
        : field.y - dummy.startY;
      return position / (dummy.length - 1);
    }

    _highlightWord(dummy) {
      let grid = this._getGrid();
      this.highlightedWord = dummy;
      this.highlightedCells = [];

      let clueField = grid[dummy.y][dummy.x];
      clueField.highlighted = true;
      this.highlightedCells.push(clueField);

      for (let j = 0; j < dummy.length; j++) {
        let x = dummy.startX + (dummy.horizontal ? j : 0);
        let y = dummy.startY + (dummy.horizontal ? 0 : j);
        let field = grid[y][x];
        field.highlighted = true;
        this.highlightedCells.push(field);
      }
    }

    _clearHighlightedWord() {
      this.highlightedCells.forEach(function (field) {
        field.highlighted = false;
      });
      this.highlightedWord = null;
      this.highlightedCells = [];
    }

    hideCurrentWord() {
      this._clearHighlightedWord();
      if (this.focusedCell != null) {
        let grid = this._getGrid();
        grid[this.focusedCell.y][this.focusedCell.x].focused = false;
        this.focusedCell = null;
      }
    }

    _setFocusedCell(x, y) {
      let grid = this._getGrid();
      if (this.focusedCell != null) {
        grid[this.focusedCell.y][this.focusedCell.x].focused = false;
      }
      grid[y][x].focused = true;
      this.focusedCell = { x: x, y: y };
    }
  };
});
