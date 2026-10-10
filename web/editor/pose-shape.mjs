const clone = value => JSON.parse(JSON.stringify(value));
// Pose records remain backward compatible: an absent flag means include shape.
export function restorePoseShape(record, currentPeople) {
    const saved = clone(record.doc);
    if (record.includeShape !== false) return saved;
    const shapes = currentPeople.map(({ mesh, proportions }) => ({ mesh: clone(mesh), proportions: clone(proportions) }));
    Object.assign(saved, shapes[0]);
    if (saved.people) saved.people = saved.people.map((person, i) => ({ ...person, ...(shapes[i] || shapes[0]) }));
    return saved;
}
export function omitPoseShape(doc) {
    const saved = clone(doc);
    for (const person of [saved, ...(saved.people || [])]) {
        delete person.mesh; delete person.proportions;
        // Bone position/scale belongs to shape; keep rotations only.
        if (person.pose) for (const key of ['bonePositions', 'ikEffectorPositions', 'poleTargetPositions', 'hipBonePosition', 'camera', 'cameraParams']) delete person.pose[key];
    }
    return saved;
}
