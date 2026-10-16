| WebGPU distance-field GI (Slate exhibit) in a Frontier editor workspace — drift yard, ControlVehicle burnouts, tyre smoke & fire, fracture, stress test | [IlluminationHost/index.html](IlluminationHost/index.html) — serve it, see [IlluminationHost/README.md](IlluminationHost/README.md) |

`IlluminationHost/` needs no install step, but it must be served over HTTP (WebGPU and its relative shader fetches
do not work from `file://`):

```sh
node Experimental/IlluminationHost/ExhibitExchange.mjs --port 8080
```
