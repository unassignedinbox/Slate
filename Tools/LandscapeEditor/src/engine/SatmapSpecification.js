//============================================================================================================================================
//                                                           SATMAPSPECIFICATION.JS
//============================================================================================================================================
// 📦 Tools/LandscapeEditor/src/engine/SatmapSpecification.js — Satmap catalogue: stylised material palettes, surface drivers with
//    physical units and default bands, and satmap mix modes.

//------------------------------------------------------------------------------------------------------------------------
//                                                       MATERIALS
//------------------------------------------------------------------------------------------------------------------------
// Stylised palettes: deliberately simplified, not measured reflectance. Several colours per material give natural variation.
export const MATERIALS = [
    { id: 'soil', label: 'Soil & loam', colors: ['#6b5a44', '#5d4d39', '#7b6749'] },
    { id: 'rock', label: 'Grey rock', colors: ['#77716a', '#8b847b', '#5f5a54'] },
    { id: 'sandstone', label: 'Sandstone', colors: ['#c77b4f', '#b8613f', '#d89a68', '#a4543a'] },
    { id: 'strata', label: 'Banded strata', colors: ['#dcb48c', '#b8795a', '#e6c9a3', '#9d5d43', '#c99b72'] },
    { id: 'basalt', label: 'Dark basalt', colors: ['#2d2c2f', '#3a383c', '#24232a'] },
    { id: 'scree', label: 'Scree & talus', colors: ['#8f8578', '#7d7367', '#a39a8c'] },
    { id: 'sand', label: 'Desert sand', colors: ['#d9b77e', '#cba56c', '#e6c995'] },
    { id: 'varnish', label: 'Desert varnish', colors: ['#6d4a3b', '#5a3e33', '#7e5a46'] },
    { id: 'gravel', label: 'Pale gravel', colors: ['#b8b09c', '#a6a08d', '#c9c1ad'] },
    { id: 'grass', label: 'Meadow grass', colors: ['#7f9c50', '#6d8d45', '#93ad62'] },
    { id: 'scrub', label: 'Dry scrub', colors: ['#8e8b58', '#7b7850', '#a09d66'] },
    { id: 'forest', label: 'Conifer forest', colors: ['#2f4f33', '#3a5b3a', '#274629'] },
    { id: 'moss', label: 'Moss & lichen', colors: ['#5f7d46', '#4c6b3c', '#72904f'] },
    { id: 'lichen', label: 'Yellow lichen', colors: ['#a2a24f', '#8d9447', '#b5b25e'] },
    { id: 'wetland', label: 'Wetland & mud', colors: ['#3f4f3c', '#4b5d45', '#33422f'] },
    { id: 'snow', label: 'Snow', colors: ['#f1f5f8', '#e1e9f0', '#fbfdff'] },
    { id: 'ice', label: 'Glacier ice', colors: ['#cfe4f0', '#b5d4e8', '#e4f2f9'] },
    { id: 'water', label: 'River & lake', colors: ['#2a5c74', '#33708a', '#245063'] },
    { id: 'beach', label: 'Beach sand', colors: ['#e3d4a9', '#d6c596', '#efe4c2'] }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                    SURFACE DRIVERS
//------------------------------------------------------------------------------------------------------------------------
// Drivers are physical quantities. lo, hi and soft give the default band; min and max bound the editor sliders.
export const DRIVERS = [
    { id: 'height', label: 'Elevation', unit: 'm', min: -500, max: 5000, step: 5, lo: 0, hi: 1000, soft: 40, hint: 'Altitude above the datum.' },
    { id: 'slope', label: 'Slope', unit: '°', min: 0, max: 70, step: 0.5, lo: 0, hi: 25, soft: 4, hint: 'Steepness of the surface.' },
    { id: 'protrusion', label: 'Protrusion', unit: 'm', min: -200, max: 200, step: 1, lo: 0, hi: 60, soft: 10, hint: 'Height above the surrounding ground: ridges and spurs are positive.' },
    { id: 'river', label: 'River channels', unit: '', min: 0, max: 1, step: 0.01, lo: 0.5, hi: 1, soft: 0.1, hint: 'Drainage concentration from catchment area.' },
    { id: 'sediment', label: 'Sedimentation', unit: 'm', min: 0, max: 80, step: 0.5, lo: 1, hi: 80, soft: 2, hint: 'Material deposited by erosion layers.' },
    { id: 'erosion', label: 'Net erosion', unit: 'm', min: -200, max: 800, step: 1, lo: 20, hi: 800, soft: 10, hint: 'Height removed since the first erosion layer.' },
    { id: 'wetness', label: 'Wetness', unit: '', min: 0, max: 1, step: 0.01, lo: 0.6, hi: 1, soft: 0.1, hint: 'Topographic wetness index: hollows that collect water.' },
    { id: 'bedding', label: 'Caprock', unit: '', min: 0, max: 1, step: 0.01, lo: 0.5, hi: 1, soft: 0.1, hint: 'Hard caprock beds from the bedding model.' },
    { id: 'coast', label: 'Distance from coast', unit: 'm', min: 0, max: 3000, step: 10, lo: 0, hi: 300, soft: 40, hint: 'Land distance from the shoreline.' },
    { id: 'aspect', label: 'North-facing', unit: '', min: 0, max: 1, step: 0.01, lo: 0.5, hi: 1, soft: 0.1, hint: 'Exposure: 1 faces north, 0 faces south.' }
];

export const SATMAP_MIX_MODES = [
    { id: 'over', label: 'Paint over' },
    { id: 'multiply', label: 'Multiply' },
    { id: 'lighten', label: 'Lighten' },
    { id: 'darken', label: 'Darken' }
];

export function materialById(id)
{
    return MATERIALS.find((material) => material.id === id) || MATERIALS[0];
}

export function driverById(id)
{
    return DRIVERS.find((driver) => driver.id === id) || DRIVERS[0];
}
