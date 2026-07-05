sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "kreuzwort/kreuzwort/util/Dummy",
    "kreuzwort/kreuzwort/util/Generator",
  ],
  (Controller, JSONModel, Dummy, Generator) => {
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
        this.addArrows();
      },

      reset() {
        this.resetArrows();
        this.gridGenerator.reset();
        this.addArrows();
      },

      setGrid(grid) {
        this.getView().setModel(new JSONModel(grid), "grid");
      },

      step() {
        this.gridGenerator.step();
        this.addArrows();
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
    });
  },
);
