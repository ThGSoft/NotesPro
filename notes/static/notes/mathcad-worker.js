/* Each run gets its own scope and a timeout enforced by the worksheet host. */
importScripts('vendor/mathjs/math.js', 'mathcad.js');
self.onmessage = event => {
  try {
    self.postMessage({rows: self.NotesProMathcad.evaluate(event.data.source, event.data.precision)});
  } catch (error) {
    self.postMessage({error: error.message});
  }
};
