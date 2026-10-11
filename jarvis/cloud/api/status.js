// GET /api/status: is the supercharger on? {on, owner, model, until}. See ../lib/core.js.
import { serve } from './_app.js';
export default serve('status');
