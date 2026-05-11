sap.ui.define(
  ["sap/ui/model/json/JSONModel", "kreuzwort/kreuzwort/util/Dummy"],
  function (JSONModel, Dummy) {
    "use strict";

    return class Generator {
      constructor(controllerRef) {
        this.controller = controllerRef;
        this.grid = null;
        this.dummys = [];
      }

      init() {
        let settings = this.controller.getView().getModel("settings");
        this.height = settings.getProperty("/height");
        this.width = settings.getProperty("/width");
        this.maxLength = settings.getProperty("/maxLength");

        this.resetGrid();
        this.placeFirstDummy();
        this.controller.getView().setModel(this.getGrid(), "grid");
      }

      reset() {
        this.dummys = [];
        this.resetGrid();
        this.placeFirstDummy();
        this.controller.getView().setModel(this.getGrid(), "grid");
      }

      resetGrid() {
        const grid = [];
        for (let y = 0; y < this.height; y++) {
          grid.push([]);
          let row = grid[y];
          for (let x = 0; x < this.width; x++) {
            row[x] = {
              x: x,
              y: y,
              isEmpty: true,
              isLetter: false,
              isClue: false,
              dummyHorizontal: null,
              dummyVertical: null,
              nextWordLocation: false,
              reserved: false,
              hasVerticalWord: false,
              hasHorizontalWord: false,
            };
          }
        }
        this.grid = new JSONModel(grid);
      }

      refreshGrid() {
        let gridData = this.grid.getData();
        for (let i = 0; i < this.dummys.length; i++) {
          let dummy = this.dummys[i];
          if (!dummy.shaped) {
            continue;
          }
          gridData[dummy.y][dummy.x].isEmpty = false;
          gridData[dummy.y][dummy.x].isLetter = false;
          gridData[dummy.y][dummy.x].isClue = true;

          // fields for the letters of the word
          for (let j = 0; j < dummy.length; j++) {
            let x = dummy.startX + (dummy.horizontal ? j : 0);
            let y = dummy.startY + (dummy.horizontal ? 0 : j);
            let field = gridData[y][x];
            field.isEmpty = false;
            field.isLetter = true;

            if (dummy.horizontal) {
              field.dummyHorizontal = dummy;
            } else {
              field.dummyVertical = dummy;
            }

            if (dummy.horizontal) {
              field.hasHorizontalWord = true;
            } else {
              field.hasVerticalWord = true;
            }

            gridData[y][x] = field;
          }

          // field directly to the right and below the clue field
          if (
            gridData[dummy.y][dummy.x + 1] &&
            !gridData[dummy.y][dummy.x + 1].isClue
          ) {
            gridData[dummy.y][dummy.x + 1].hasHorizontalWord = true;
          }
          if (
            gridData[dummy.y + 1] &&
            gridData[dummy.y + 1][dummy.x] &&
            !gridData[dummy.y + 1][dummy.x].isClue
          ) {
            gridData[dummy.y + 1][dummy.x].hasVerticalWord = true;
          }
        }
        this.grid.setData(gridData);
        this.controller.getView().setModel(this.getGrid(), "grid");
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

      placeFirstDummy() {
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
        this.dummys.push(dummy);
        dummy.shape();
      }

      getRandomInt(min, max) {
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
      }
    };
  },
);
