import triangulate from "earcut";

export class Earcut {
    static triangulate(data, holeIndices, dim = 2) {
        return triangulate(data, holeIndices, dim);
    }
}

export default Earcut;
