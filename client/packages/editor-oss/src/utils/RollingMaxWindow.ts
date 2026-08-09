export class RollingMaxWindow {
    private readonly values: number[];
    private readonly capacity: number;
    private readonly floor: number;
    private nextIndex = 0;
    private count = 0;
    private maxValue: number;

    constructor(capacity: number, floor = 1) {
        this.capacity = Math.max(1, Math.floor(capacity));
        this.floor = floor;
        this.maxValue = floor;
        this.values = new Array(this.capacity);
    }

    push(value: number): number {
        const sample = Number.isFinite(value) ? value : this.floor;

        if (this.count < this.capacity) {
            this.values[this.nextIndex] = sample;
            this.nextIndex = (this.nextIndex + 1) % this.capacity;
            this.count++;
            if (sample > this.maxValue) {
                this.maxValue = sample;
            }
            return this.maxValue;
        }

        const evicted = this.values[this.nextIndex] ?? this.floor;
        this.values[this.nextIndex] = sample;
        this.nextIndex = (this.nextIndex + 1) % this.capacity;

        if (sample >= this.maxValue) {
            this.maxValue = sample;
        } else if (evicted >= this.maxValue) {
            this.recomputeMax();
        }

        return this.maxValue;
    }

    clear(): void {
        this.nextIndex = 0;
        this.count = 0;
        this.maxValue = this.floor;
    }

    get max(): number {
        return this.maxValue;
    }

    get size(): number {
        return this.count;
    }

    private recomputeMax(): void {
        let maxValue = this.floor;
        for (let i = 0; i < this.count; i++) {
            const value = this.values[i] ?? this.floor;
            if (value > maxValue) {
                maxValue = value;
            }
        }
        this.maxValue = maxValue;
    }
}
