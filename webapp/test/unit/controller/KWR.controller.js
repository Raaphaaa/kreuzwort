/*global QUnit*/

sap.ui.define([
	"kreuzwort/kreuzwort/controller/KWR.controller"
], function (Controller) {
	"use strict";

	QUnit.module("KWR Controller");

	QUnit.test("I should test the KWR controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
