sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "kreuzwort/kreuzwort/util/Dummy",
    "kreuzwort/kreuzwort/util/Generator",
    "kreuzwort/kreuzwort/util/WordHighlighter",
  ],
  (Controller, JSONModel, Fragment, Dummy, Generator, WordHighlighter) => {
    "use strict";

    return Controller.extend("kreuzwort.kreuzwort.controller.KWR", {
      onInit() {
        this.getOwnerComponent()
          .getRouter()
          .getRoute("RouteKWR")
          .attachMatched(this._onRouteMatched, this);
      },

      _onRouteMatched() {
        this.gridGenerator = new Generator(this);
        this.wordHighlighter = new WordHighlighter(this);
        this.gridGenerator.init();
        this._attachPressEvent();
        this.addArrows();
      },

      reset() {
        this._pressAttachedCells = null;
        this.resetArrows();
        this.wordHighlighter.reset();
        this.gridGenerator.reset();
        this._attachPressEvent();
        this.addArrows();
      },

      setGrid(grid) {
        let oModel = this.getView().getModel("grid");
        if (!oModel) {
          oModel = new JSONModel();
          this.getView().setModel(oModel, "grid");
        }
        oModel.setData(grid);
        this._attachPressEvent();
      },

      step() {
        this.gridGenerator.step();
        this.addArrows();
      },

      step10() {
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
        this.gridGenerator.step();
      },

      removeLastWord() {
        this.gridGenerator.removeLastWord();
        this.addArrows();
      },

      resetArrows() {
        let oVBox = this.getView().byId("VBoxKWR");
        let rows = oVBox.getItems();
        rows.forEach(function (row) {
          let cells = row.getItems();
          cells.forEach(function (cell) {
            cell.data("arrowdirection", "", true);
          });
        });
      },

      addArrows() {
        let that = this;
        this.gridGenerator.getArrowPositions().forEach(function (arrow) {
          let oVBox = that.getView().byId("VBoxKWR");
          let row = oVBox.getItems()[arrow.y];
          let cell = row.getItems()[arrow.x];
          cell.data("arrowdirection", arrow.direction, true);
        });
      },

      _attachPressEvent() {
        if (!this._pressAttachedCells) {
          this._pressAttachedCells = new WeakSet();
        }
        let that = this;
        let rows = this.getView().byId("VBoxKWR").getItems();
        rows.forEach(function (row) {
          let cells = row.getItems();
          cells.forEach(function (cell) {
            if (that._pressAttachedCells.has(cell)) {
              return;
            }
            cell.addEventDelegate({
              onclick: that._onCellClick.bind(that),
            });
            that._pressAttachedCells.add(cell);
          });
        });
      },

      _onCellClick(oEvent) {
        let dataset = oEvent.target.dataset;
        let x = dataset.x;
        let y = dataset.y;

        // let oControl = this._getGridControl(x, y);
        // let oContext = oControl.getBindingContext("grid");

        this.wordHighlighter.highlight(x, y);
      },

      _getGridControl(x, y) {
        return this.getView().byId("VBoxKWR").getItems()[y].getItems()[x];
      },
    });
  },
);
