// The Python leg of tools/check-cross-language.js on its own, with Python
// imported from an installed consumer — what tools/check-python-package.py
// runs against each fresh venv. The runner and the probe live in
// check-cross-language.js; this keeps the original command line:
//
//   node tools/check-python-js-compat.js <python>
const { main } = require('./check-cross-language');
const python = process.argv[2];
if (!python) throw new Error('Pass the installed consumer Python executable.');
main({ python }).catch(error => { console.error(error); process.exitCode = 1; });
