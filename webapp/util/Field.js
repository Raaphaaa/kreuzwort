sap.ui.define([], function () {
  "use strict";

  /** Field-Klasse
   * Jedes Field Objekt repräsentiert ein Feld im Grid. Gespeichert wird nur der
   * eigentliche Zustand (welcher Dummy belegt das Feld, wer hat es markiert).
   * Alle Flags wie isEmpty/isLetter/reserved werden daraus über Getter
   * abgeleitet und können dadurch nie auseinanderlaufen.
   */
  return class Field {
    constructor(x, y, generator) {
      this.x = x;
      this.y = y;
      this.generator = generator;

      // Inhalt: Dummy, dessen Hinweis auf diesem Feld steht, bzw. die Dummys,
      // deren Wort horizontal/vertikal über dieses Feld verläuft
      this.clueFor = null;
      this.dummyHorizontal = null;
      this.dummyVertical = null;

      // Marker: wer hält dieses Feld gerade als (Pflicht-)Position für ein
      // neues Hinweisfeld. Owner ist ein Dummy oder der structuralForceKey des
      // Generators (siehe Generator._markStructuralForcedFields).
      this.forcedBy = new Set();
      this.markedBy = new Set();

      // Bewertung, wird von Generator._evaluateGrid() gesetzt
      this.score = 0;
      this.edges = 0;
      this.clues = 0;
      this.blocked = 0;
      this.letters = 0;

      // UI-Zustand
      this.highlighted = false;
      this.focused = false;
    }

    // ---- Abgeleitete Flags (auch für das Binding im View) ----

    get isClue() {
      return this.clueFor !== null;
    }

    get isLetter() {
      return this.dummyHorizontal !== null || this.dummyVertical !== null;
    }

    get isEmpty() {
      return !this.isClue && !this.isLetter;
    }

    get hasHorizontalWord() {
      return this.dummyHorizontal !== null;
    }

    get hasVerticalWord() {
      return this.dummyVertical !== null;
    }

    // Feld muss zwingend ein Hinweisfeld werden
    get reserved() {
      return this.forcedBy.size > 0;
    }

    // Feld ist (verpflichtend oder optional) als Position für ein neues
    // Hinweisfeld markiert
    get nextWordLocation() {
      return this.forcedBy.size > 0 || this.markedBy.size > 0;
    }

    // Feld ist für Buchstaben gesperrt, da es bereits ein Hinweisfeld ist
    // oder eines werden muss
    get isClueOrReserved() {
      return this.isClue || this.reserved;
    }

    // ---- Inhalt setzen/entfernen ----

    setClue(dummy) {
      this.clueFor = dummy;
    }

    removeClue() {
      this.clueFor = null;
    }

    setLetter(dummy) {
      if (dummy.horizontal) {
        this.dummyHorizontal = dummy;
      } else {
        this.dummyVertical = dummy;
      }
    }

    removeLetter(dummy) {
      if (dummy.horizontal) {
        this.dummyHorizontal = null;
      } else {
        this.dummyVertical = null;
      }
    }

    // ---- Marker ----

    // owner: der Dummy, der für diesen Marker verantwortlich ist. Wird der
    // Dummy später entfernt/umgeformt, wird der Marker über unmark() wieder
    // zurückgenommen.
    mark(owner, { forced = false } = {}) {
      if (forced) {
        this.forcedBy.add(owner);
      } else {
        this.markedBy.add(owner);
      }
    }

    unmark(owner) {
      this.forcedBy.delete(owner);
      this.markedBy.delete(owner);
    }

    // true, wenn das Feld durch einen anderen Owner als den angegebenen
    // reserviert ist
    isForcedByOtherThan(owner) {
      for (const forcingOwner of this.forcedBy) {
        if (forcingOwner !== owner) {
          return true;
        }
      }
      return false;
    }

    // ---- Nachbarn ----
    // Liefern null, wenn das Feld am Rand liegt

    getNeighbor(dx, dy) {
      return this.generator.getField(this.x + dx, this.y + dy);
    }

    get left() {
      return this.getNeighbor(-1, 0);
    }

    get right() {
      return this.getNeighbor(1, 0);
    }

    get above() {
      return this.getNeighbor(0, -1);
    }

    get below() {
      return this.getNeighbor(0, 1);
    }

    // Direkt angrenzende Felder (ohne Diagonalen), Randfelder werden ausgelassen
    getAdjacentFields() {
      return [this.left, this.right, this.above, this.below].filter(Boolean);
    }

    // Alle 8 umliegenden Felder (inkl. Diagonalen), Randfelder werden ausgelassen
    getSurroundingFields() {
      return [
        [-1, 0],
        [-1, -1],
        [0, -1],
        [1, -1],
        [1, 0],
        [1, 1],
        [0, 1],
        [-1, 1],
      ]
        .map(([dx, dy]) => this.getNeighbor(dx, dy))
        .filter(Boolean);
    }
  };
});
