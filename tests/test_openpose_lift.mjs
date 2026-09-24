// Run: node tests/test_openpose_lift.mjs
import assert from 'node:assert/strict';
import { liftOpenPose, isFacingAway } from '../web/editor/openpose-lift.mjs';

// Mannequin rest (world units, y up, subject's left at +x), T-pose-ish arms down.
const rest = {
    hipMid: [0, 0, 0], neck: [0, 5, 0], head: [0, 7, 0],
    ls: [1.7, 5, 0], le: [2.2, 2.2, 0], lw: [2.5, -0.3, 0], rs: [-1.7, 5, 0], re: [-2.2, 2.2, 0], rw: [-2.5, -0.3, 0],
    lh: [1, 0, 0], lk: [1, -4, 0], la: [1, -8, 0], rh: [-1, 0, 0], rk: [-1, -4, 0], ra: [-1, -8, 0],
};
// Image of the same pose seen from the front: pixel x = world x * 10 + 400, pixel y = 400 - world y * 10.
const toImage = world => Object.fromEntries(Object.entries(world).filter(([key]) => key !== 'hipMid').map(([key, [x, y]]) => [key, [x * 10 + 400, 400 - y * 10]]));
const front = toImage(rest);

{
    const { kps, facingAway, scale } = liftOpenPose(front, rest);
    assert.equal(facingAway, false);
    assert.ok(Math.abs(scale - 0.1) < 1e-9, 'unforeshortened pose keeps the true scale');
    for (const point of Object.values(kps)) assert.ok(Math.abs(point[2]) < 1e-6, 'a flat pose has no depth');
}

{
    // Kneeling toward the camera: the thigh looks half as long, so the knee must come forward.
    const kneel = structuredClone(front);
    kneel.lk = [410, 420];
    const { kps } = liftOpenPose(kneel, rest);
    assert.ok(kps.lk[2] > 3, 'foreshortened thigh puts the knee in front');
    const flipped = liftOpenPose(kneel, rest, { lLegUpper: true }).kps;
    assert.ok(flipped.lk[2] < -3, 'flipping the whole leg sends the knee back');
}

{
    // Back view: the subject's right shoulder appears on the image's right.
    const back = Object.fromEntries(Object.entries(front).map(([key, [x, y]]) => [key, [800 - x, y]]));
    assert.equal(isFacingAway(back), true);
    back.lk = [390, 420];
    const { kps, facingAway } = liftOpenPose(back, rest);
    assert.equal(facingAway, true);
    assert.ok(kps.lk[2] < -3, 'a back view mirrors depth: forward knees point away from the camera');
    assert.equal(liftOpenPose(back, rest, { body: true }).facingAway, false);
}

console.log('openpose-lift: all tests passed');
