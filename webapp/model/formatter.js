sap.ui.define([], function () {
  "use strict";
  return {
    formatColor(
      isEmpty,
      isLetter,
      isClue,
      hasHorizontal,
      hasVertical,
      isNextWordLocation,
      isReserved,
      isHighlighted,
      isFocused,
      showLocations,
      showMissingDirections,
    ) {
      if (isEmpty) {
        if (showLocations) {
          if (isNextWordLocation) {
            if (isReserved) {
              return "red";
            } else {
              return "orange";
            }
          }
        }
      } else {
        if (isLetter) {
          if (showMissingDirections) {
            if (hasHorizontal && hasVertical) {
              return "lightgreen";
            } else if (hasHorizontal) {
              return "lightblue";
            } else if (hasVertical) {
              return "lightyellow";
            }
          } else {
            if (isFocused) {
              return "focusletter";
            } else if (isHighlighted) {
              return "highlightletter";
            }
            return "lightgray";
          }
        } else if (isClue) {
          if (isFocused) {
            return "focusclue";
          } else if (isHighlighted) {
            return "highlightclue";
          }
          return "blue";
        }
      }
      return "";
    },

    formatText(
      x,
      y,
      score,
      isEmpty,
      isClue,
      isLetter,
      isNextWordLocation,
      showCoordinates,
      showReservedLocations,
      showEmptyEvaluations,
      showClueEvaluations,
      showLetterEvaluations,
    ) {
      if (showCoordinates) {
        return "x" + x + " y" + y;
      }

      if (isEmpty && showEmptyEvaluations) {
        return score;
      }

      if (showClueEvaluations) {
        if (!isEmpty && isClue) {
          return score;
        }

        if (isEmpty && isNextWordLocation && showReservedLocations) {
          return score;
        }
      }

      if (!isEmpty && isLetter && showLetterEvaluations) {
        return score;
      }
    },
  };
});
