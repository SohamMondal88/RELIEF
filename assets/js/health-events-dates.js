// Native date inputs expose YYYY-MM-DD. The existing health-events
// validation expects DD-MM-YYYY, so mirror selections into the
// original named fields before the existing form handlers run.
(function () {
  "use strict";

  var datePairs = [
    ["filter-from-picker", "filter-from"],
    ["filter-to-picker", "filter-to"],
    ["event-start-date-picker", "event-start-date"],
    ["event-end-date-picker", "event-end-date"]
  ];

  function toDayFirst(value) {
    if (!value) return "";

    var parts = value.split("-");

    return parts.length === 3
      ? parts[2] + "-" + parts[1] + "-" + parts[0]
      : "";
  }

  function syncDate(pickerId, fieldId) {
    var picker = document.getElementById(pickerId);
    var field = document.getElementById(fieldId);

    if (picker && field) {
      field.value = toDayFirst(picker.value);
    }
  }

  datePairs.forEach(function (pair) {
    var picker = document.getElementById(pair[0]);

    if (!picker) return;

    var update = function () {
      syncDate(pair[0], pair[1]);
    };

    picker.addEventListener("input", update);
    picker.addEventListener("change", update);
  });

  [
    document.getElementById("events-filter-form"),
    document.getElementById("event-submit-form")
  ].forEach(function (form) {
    if (!form) return;

    form.addEventListener("submit", function () {
      datePairs.forEach(function (pair) {
        syncDate(pair[0], pair[1]);
      });
    }, true);
  });

  var startPicker = document.getElementById(
    "event-start-date-picker"
  );

  var endPicker = document.getElementById(
    "event-end-date-picker"
  );

  if (startPicker && endPicker) {
    var updateEndMinimum = function () {
      endPicker.min = startPicker.value || "";

      if (
        endPicker.value &&
        startPicker.value &&
        endPicker.value < startPicker.value
      ) {
        endPicker.value = startPicker.value;

        syncDate(
          "event-end-date-picker",
          "event-end-date"
        );
      }
    };

    startPicker.addEventListener(
      "change",
      updateEndMinimum
    );

    updateEndMinimum();
  }
})();
