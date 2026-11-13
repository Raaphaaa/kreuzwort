sap.ui.define([], function () {
  "use strict";

  /** Random-Klasse
   * Seedbarer Zufallsgenerator (mulberry32). Gleicher Seed ergibt immer die
   * gleiche Zahlenfolge - dadurch lässt sich ein generiertes Rätsel exakt
   * reproduzieren (Debugging, Tests). Math.random ist nicht seedbar und
   * wird deshalb nur zum Erzeugen eines neuen Seeds verwendet.
   */
  return class Random {
    constructor(seed) {
      this.seed = seed >>> 0;
      this._state = this.seed;
    }

    static createSeed() {
      return Math.floor(Math.random() * 4294967296) >>> 0;
    }

    // Gleichverteilte Zahl in [0, 1)
    next() {
      this._state = (this._state + 0x6d2b79f5) >>> 0;
      let t = this._state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    // Ganze Zahl in [min, max] (beide inklusive)
    int(min, max) {
      min = Math.ceil(min);
      max = Math.floor(max);
      return Math.floor(this.next() * (max - min + 1)) + min;
    }
  };
});
