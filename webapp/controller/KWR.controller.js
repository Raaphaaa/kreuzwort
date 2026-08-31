sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "kreuzwort/kreuzwort/util/Dummy",
    "kreuzwort/kreuzwort/util/Generator",
  ],
  (Controller, JSONModel, Fragment, Dummy, Generator) => {
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
        this.gridGenerator.init();
        this._attachPressEvent();
        this.addArrows();
      },

      reset() {
        this.resetArrows();
        this.gridGenerator.reset();
        this._attachPressEvent();
        this.addArrows();
      },

      setGrid(grid) {
        this.getView().setModel(new JSONModel(grid), "grid");
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
          if (cell.data("arrowdirection") != "") {
            cell.data("arrowdirection", arrow.direction, true);
          }
        });
      },

      _attachPressEvent() {
        let rows = this.getView().byId("VBoxKWR").getItems();
        let that = this;
        rows.forEach(function (row) {
          let cells = row.getItems();
          cells.forEach(function (cell) {
            cell.addEventDelegate({
              onclick: that._onCellClick.bind(that),
            });
          });
        });
      },

      _onCellClick(oEvent) {
        let dataset = oEvent.target.dataset;
        let x = dataset.x;
        let y = dataset.y;

        // let oControl = this._getGridControl(x, y);
        // let oContext = oControl.getBindingContext("grid");

        this.gridGenerator.highlight(x, y);
      },

      _getGridControl(x, y) {
        return this.getView().byId("VBoxKWR").getItems()[y].getItems()[x];
      },
    });
  },
);
