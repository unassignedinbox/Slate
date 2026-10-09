// DrainageStructure: priority-flood depression filling (Barnes et al. 2014) with eight-neighbour flood-direction routing.
// Border cells and everything below sea level are outlets. The pop order is a topological order: receivers come before donors.

const Neighbours = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const Epsilon = 1e-4;

export function ComputeDrainage(height, n, sea) {
    const size = n * n;
    const filled = Float32Array.from(height);
    const receivers = new Int32Array(size);
    const order = new Int32Array(size);
    const visited = new Uint8Array(size);
    const heapKeys = new Float64Array(size);
    const heapValues = new Int32Array(size);
    let heapLength = 0;

    const push = (cell, key) => {
        let i = heapLength++;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heapKeys[parent] <= key) break;
            heapKeys[i] = heapKeys[parent];
            heapValues[i] = heapValues[parent];
            i = parent;
        }
        heapKeys[i] = key;
        heapValues[i] = cell;
    };

    const pop = () => {
        const top = heapValues[0];
        heapLength--;
        if (heapLength > 0) {
            const key = heapKeys[heapLength];
            const value = heapValues[heapLength];
            let i = 0;
            for (;;) {
                let child = 2 * i + 1;
                if (child >= heapLength) break;
                if (child + 1 < heapLength && heapKeys[child + 1] < heapKeys[child]) child++;
                if (heapKeys[child] >= key) break;
                heapKeys[i] = heapKeys[child];
                heapValues[i] = heapValues[child];
                i = child;
            }
            heapKeys[i] = key;
            heapValues[i] = value;
        }
        return top;
    };

    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            const i = y * n + x;
            const border = x === 0 || y === 0 || x === n - 1 || y === n - 1;
            if (border || height[i] < sea) {
                visited[i] = 1;
                receivers[i] = i;
                push(i, filled[i]);
            }
        }
    }

    let popped = 0;
    while (heapLength > 0) {
        const cell = pop();
        order[popped++] = cell;
        const cx = cell % n;
        const cy = (cell - cx) / n;
        for (let k = 0; k < 8; k++) {
            const nx = cx + Neighbours[k][0];
            const ny = cy + Neighbours[k][1];
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const next = ny * n + nx;
            if (visited[next]) continue;
            visited[next] = 1;
            receivers[next] = cell;
            filled[next] = Math.max(height[next], filled[cell] + Epsilon);
            push(next, filled[next]);
        }
    }
    return { filled, receivers, order, size };
}

// Drainage area in cells (each cell counts itself). Donors are accumulated before their receivers by walking the order backwards.
export function AccumulateArea(drainage) {
    const { receivers, order, size } = drainage;
    const area = new Float32Array(size).fill(1);
    for (let k = size - 1; k >= 0; k--) {
        const i = order[k];
        const r = receivers[i];
        if (r !== i) {
            area[r] += area[i];
        }
    }
    return area;
}

// True when receiver differs from its donor along a diagonal, so the routing distance is sqrt(2) cells.
export function IsDiagonalRoute(i, r, n) {
    return (i % n !== r % n) && (Math.floor(i / n) !== Math.floor(r / n));
}
