function verify() {
  /* Generated symbolic driver for adminWrite */
  var S$ = require("S$");
  var { state } = require("./state");
  var { adminWrite } = require("./basecode");
  var out;
  var req = S$.symbol("req", "");
  var ctx = S$.symbol("ctx", "");
  out = adminWrite(req, ctx);
  console.log("Symbolic output:", out);
}
verify();
