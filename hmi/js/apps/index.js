// App registry. Adding an app = one module + one line here.
import cockpit from './cockpit.js';
import suspension from './suspension.js';
import aero from './aero.js';
import tyres from './tyres.js';
import weather from './weather.js';
import wallet from './wallet.js';
import online from './online.js';

export const APPS = [cockpit, suspension, aero, tyres, weather, wallet, online];
