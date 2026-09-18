/* =========================================================
   garage.js — the workshop behind every page.

   Builds a fixed "garage" scene (wall, monitors, floor) and two
   industrial robot arms, one on each side of the content. The
   arms are drawn as SVG and driven by simple forward kinematics:
   every few seconds each arm picks a new pose, eases into it,
   holds it, and repeats. The hydraulic pistons and the cable are
   recomputed from the joint angles every frame, so they always
   stay attached to the right places.

   Nothing to configure. To change how the arms look, edit
   armMarkup(). To change how they move, edit RANGES / TIMING.
   Users with "reduce motion" turned on get a still pose.
   ========================================================= */

(function () {
  "use strict";

  // ---- geometry (SVG units, viewBox is 400 x 760) --------------------
  var L1 = 250;                 // upper-arm length
  var L2 = 210;                 // forearm length
  var SHOULDER = { x: 70, y: 630 };

  // ---- motion ---------------------------------------------------------
  var RANGES = {                // degrees (grip is 0 closed .. 1 open)
    a1: [-14, 14],              // shoulder
    a2: [10, 125],              // elbow
    a3: [-60, 60],              // wrist
    grip: [0.05, 1]
  };
  // now and then an arm "reaches down to the workbench"
  var WORK_RANGES = { a1: [-14, -4], a2: [95, 125], a3: [10, 50] };
  var TIMING = { moveMin: 1.5, moveMax: 2.7, holdMin: 0.5, holdMax: 1.7 }; // seconds

  var REST_POSE = { a1: 0, a2: 48, a3: -6, grip: 0.6 };

  // ---- small helpers --------------------------------------------------
  function rot(p, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }
  function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---- arm artwork ----------------------------------------------------
  // `k` keeps each arm's sketch filter id unique.
  function armMarkup(k) {
    var bolt = function (x, y) {
      return '<circle cx="' + x + '" cy="' + y + '" r="2.6" fill="#2b3157" stroke="rgba(255,255,255,.35)" stroke-width=".8"/>';
    };
    var yel = '#c79a68', steel = '#d5cec1', hub = '#b86c56', silver = '#81786d';

    // a finger, built pointing up; the caller rotates it
    var finger = function (cls) {
      return '<g class="' + cls + '">' +
        '<rect x="-4.5" y="-33" width="9" height="33" rx="3" fill="' + steel + '" stroke="#4a4139" stroke-width="1"/>' +
        '<circle cx="0" cy="-33" r="4.6" fill="' + hub + '" stroke="#8c624d" stroke-width="1"/>' +
        '<g class="' + cls + '-tip">' +
          '<rect x="-3.6" y="-29" width="7.2" height="29" rx="2.6" fill="' + steel + '" stroke="#4a4139" stroke-width="1"/>' +
          '<rect x="-3.6" y="-31" width="7.2" height="5" rx="2" fill="#f0e8dc"/>' +
        '</g></g>';
    };

    return '' +
    '<svg viewBox="0 0 400 760" preserveAspectRatio="xMinYMax meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" filter="url(#sketchFilter' + k + ')">' +
    '<defs>' +
      '<filter id="sketchFilter' + k + '" x="-8%" y="-8%" width="116%" height="116%">' +
        '<feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="1" seed="' + k.charCodeAt(0) + '" result="noise"/>' +
        '<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.15" xChannelSelector="R" yChannelSelector="G"/>' +
      '</filter>' +
    '</defs>' +

    /* ---- base: floor plate, hazard band, pedestal, turntable ---- */
    '<ellipse cx="86" cy="744" rx="96" ry="9" fill="#4a4139" opacity=".55"/>' +
    '<rect x="8" y="728" width="156" height="15" rx="3" fill="' + steel + '" stroke="#4a4139" stroke-width="1.2"/>' +
    bolt(20, 735.5) + bolt(152, 735.5) +
    '<rect x="14" y="714" width="144" height="14" fill="#e8dfd2" stroke="#4a4139" stroke-width="1.2"/>' +
    '<path d="M32 714 L108 714 L98 652 L44 652 Z" fill="' + yel + '" stroke="#8c624d" stroke-width="1.5"/>' +
    '<rect x="54" y="668" width="34" height="36" rx="4" fill="#bd8968" opacity=".7"/>' +
    '<line x1="54" y1="680" x2="88" y2="680" stroke="#8c624d" stroke-width="1.5"/>' +
    '<line x1="54" y1="692" x2="88" y2="692" stroke="#8c624d" stroke-width="1.5"/>' +
    bolt(42, 700) + bolt(100, 700) +
    '<rect x="36" y="636" width="68" height="20" rx="4" fill="' + steel + '" stroke="#4a4139" stroke-width="1.2"/>' +

    /* ---- cable from the pedestal up to the upper arm ---- */
    '<path class="a-hose" fill="none" stroke="#403830" stroke-width="7" stroke-linecap="round"/>' +
    '<path class="a-hose-hi" fill="none" stroke="#756b60" stroke-width="1.6" stroke-linecap="round" transform="translate(-1.6 -1)"/>' +

    /* ---- shoulder piston (world space) ---- */
    '<g class="a-p1">' +
      '<line class="cyl" stroke="#8a8074" stroke-width="12" stroke-linecap="round"/>' +
      '<line class="cylhi" stroke="rgba(190,205,255,.28)" stroke-width="3" stroke-linecap="round"/>' +
      '<line class="rod" stroke="' + silver + '" stroke-width="5.5"/>' +
      '<circle class="ea" r="6" fill="' + hub + '" stroke="#8c624d"/><circle class="eb" r="6" fill="' + hub + '" stroke="#8c624d"/>' +
    '</g>' +

    /* ---- upper arm (joint 1) ---- */
    '<g class="a-j1">' +
      '<path d="M-27 0 L-22 -40 L-19 -' + (L1 - 14) + ' Q-19 -' + L1 + ' -10 -' + L1 + ' L10 -' + L1 + ' Q19 -' + L1 + ' 19 -' + (L1 - 14) + ' L22 -40 L27 0 Z" fill="' + yel + '" stroke="#8c624d" stroke-width="1.6"/>' +
      '<rect x="-8" y="-' + (L1 - 42) + '" width="16" height="' + (L1 - 96) + '" rx="6" fill="#b98261" opacity=".7"/>' +
      '<rect x="-15.5" y="-' + (L1 - 34) + '" width="3" height="' + (L1 - 80) + '" rx="1.5" fill="rgba(255,255,255,.35)"/>' +
      '<line x1="-19" y1="-95" x2="19" y2="-95" stroke="#956b55" stroke-width="2"/>' +
      '<line x1="-19" y1="-175" x2="19" y2="-175" stroke="#956b55" stroke-width="2"/>' +
      bolt(-13, -60) + bolt(13, -60) + bolt(-11, -(L1 - 30)) + bolt(11, -(L1 - 30)) +
      /* shoulder servo housing + hub */
      '<rect x="-34" y="-17" width="68" height="34" rx="8" fill="' + steel + '" stroke="#4a4139" stroke-width="1.4"/>' +
      '<circle r="24" fill="' + hub + '" stroke="#8c624d" stroke-width="1.6"/>' +
      '<circle r="14" fill="#6b6258" stroke="#0a0e26" stroke-width="1.2"/><circle r="5" fill="#f0e8dc"/>' +

      /* ---- forearm (joint 2) ---- */
      '<g class="a-j2">' +
        '<path d="M-22 0 L-19 -30 L-14.5 -' + (L2 - 10) + ' Q-14.5 -' + L2 + ' -8 -' + L2 + ' L8 -' + L2 + ' Q14.5 -' + L2 + ' 14.5 -' + (L2 - 10) + ' L19 -30 L22 0 Z" fill="' + yel + '" stroke="#8c624d" stroke-width="1.6"/>' +
        '<rect x="-5.5" y="-' + (L2 - 34) + '" width="11" height="' + (L2 - 86) + '" rx="5" fill="#b98261" opacity=".7"/>' +
        '<rect x="-12" y="-' + (L2 - 28) + '" width="2.6" height="' + (L2 - 76) + '" rx="1.3" fill="rgba(255,255,255,.35)"/>' +
        '<line x1="-16" y1="-110" x2="16" y2="-110" stroke="#956b55" stroke-width="2"/>' +
        bolt(-11, -56) + bolt(11, -56) + bolt(0, -(L2 - 22)) +
        /* elbow servo housing + hub */
        '<rect x="-30" y="-15" width="60" height="30" rx="7" fill="' + steel + '" stroke="#4a4139" stroke-width="1.4"/>' +
        '<circle r="21" fill="' + hub + '" stroke="#8c624d" stroke-width="1.6"/>' +
        '<circle r="12" fill="#6b6258" stroke="#0a0e26" stroke-width="1.2"/><circle r="4.4" fill="#f0e8dc"/>' +

        /* ---- wrist + gripper (joint 3) ---- */
        '<g class="a-j3" >' +
          '<rect x="-11" y="-30" width="22" height="30" rx="3" fill="' + steel + '" stroke="#4a4139" stroke-width="1.2"/>' +
          '<circle r="15" fill="' + hub + '" stroke="#8c624d" stroke-width="1.4"/><circle r="8" fill="#6b6258"/>' +
          '<rect x="-23" y="-58" width="46" height="30" rx="6" fill="' + steel + '" stroke="#4a4139" stroke-width="1.3"/>' +
          '<rect x="-16" y="-54" width="32" height="3" rx="1.5" fill="rgba(190,205,255,.25)"/>' +
          '<circle cx="0" cy="-42" r="7" fill="#b86c56" opacity=".22" class="arm-led"/>' +
          '<circle cx="0" cy="-42" r="3.2" fill="#d39b73" class="arm-led"/>' +
          '<g class="a-fl" transform="translate(-14 -58)">' + finger('a-fl-g') + '</g>' +
          '<g class="a-fr" transform="translate(14 -58)">' + finger('a-fr-g') + '</g>' +
        '</g>' +
      '</g>' +

      /* ---- elbow piston (upper-arm space) ---- */
      '<g class="a-p2">' +
        '<line class="cyl" stroke="#8a8074" stroke-width="12" stroke-linecap="round"/>' +
        '<line class="cylhi" stroke="rgba(190,205,255,.28)" stroke-width="3" stroke-linecap="round"/>' +
        '<line class="rod" stroke="' + silver + '" stroke-width="5.5"/>' +
        '<circle class="ea" r="6" fill="' + hub + '" stroke="#8c624d"/><circle class="eb" r="6" fill="' + hub + '" stroke="#8c624d"/>' +
      '</g>' +
    '</g>' +
    '</svg>';
  }

  // ---- one arm: DOM refs + kinematics --------------------------------
  function Arm(host, id, seed) {
    host.innerHTML = armMarkup(id);
    var q = function (sel) { return host.querySelector(sel); };
    this.j1 = q('.a-j1'); this.j2 = q('.a-j2'); this.j3 = q('.a-j3');
    this.fl = q('.a-fl-g'); this.flTip = q('.a-fl-g-tip');
    this.fr = q('.a-fr-g'); this.frTip = q('.a-fr-g-tip');
    this.hose = q('.a-hose'); this.hoseHi = q('.a-hose-hi');
    this.p1 = { g: q('.a-p1') }; this.p2 = { g: q('.a-p2') };
    [this.p1, this.p2].forEach(function (p) {
      p.cyl = p.g.querySelector('.cyl'); p.cylhi = p.g.querySelector('.cylhi');
      p.rod = p.g.querySelector('.rod'); p.ea = p.g.querySelector('.ea'); p.eb = p.g.querySelector('.eb');
    });

    this.rand = mulberry32(seed);
    this.from = Object.assign({}, REST_POSE);
    this.to = Object.assign({}, REST_POSE);
    this.t0 = 0; this.dur = 0.001; this.hold = 0;
    this.pose = Object.assign({}, REST_POSE);
    this.apply(REST_POSE, 0);
  }

  // Where the fingertips end up for a pose (SVG units). Used so the
  // arms never swing so far in that they slide behind the page content.
  var GRIPPER_LEN = 122;
  function tipOf(a1, a2, a3) {
    var e = add(SHOULDER, rot({ x: 0, y: -L1 }, a1));
    var w = add(e, rot({ x: 0, y: -L2 }, a1 + a2));
    return { e: e, w: w, t: add(w, rot({ x: 0, y: -GRIPPER_LEN }, a1 + a2 + a3)) };
  }
  function reachable(a1, a2, a3) {
    var k = tipOf(a1, a2, a3);
    return k.t.x <= 340 && k.t.x >= 120 && k.w.x <= 335 &&   // stay in the gutter beside the content
           k.t.y >= 70 && k.t.y <= 610 && k.w.y <= 600;        // stay above the floor and on screen
  }

  Arm.prototype.pick = function (now) {
    var r = this.rand, R = (r() < 0.35 ? WORK_RANGES : RANGES), a1, a2, a3, tries = 0;
    this.from = Object.assign({}, this.pose);
    do {
      a1 = lerp(R.a1[0], R.a1[1], r());
      a2 = lerp(R.a2[0], R.a2[1], r());
      a3 = lerp(R.a3[0], R.a3[1], r());
      tries++;
    } while (!reachable(a1, a2, a3) && tries < 60);
    if (tries >= 60) { a1 = REST_POSE.a1; a2 = REST_POSE.a2; a3 = REST_POSE.a3; }
    this.to = {
      a1: a1, a2: a2, a3: a3,
      grip: r() > 0.5 ? lerp(0.05, 0.3, r()) : lerp(0.7, 1, r())   // mostly clearly open or clearly closed
    };
    this.t0 = now;
    this.dur = lerp(TIMING.moveMin, TIMING.moveMax, r());
    this.hold = lerp(TIMING.holdMin, TIMING.holdMax, r());
  };

  Arm.prototype.update = function (now) {
    if (now > this.t0 + this.dur + this.hold) this.pick(now);
    var t = Math.min(1, (now - this.t0) / this.dur), e = ease(t), p = this.pose;
    p.a1 = lerp(this.from.a1, this.to.a1, e);
    p.a2 = lerp(this.from.a2, this.to.a2, e);
    p.a3 = lerp(this.from.a3, this.to.a3, e);
    p.grip = lerp(this.from.grip, this.to.grip, e);
    // tiny servo "hum" while holding a pose
    var hum = t >= 1 ? 0.35 : 0;
    this.apply({
      a1: p.a1 + hum * Math.sin(now * 5.1),
      a2: p.a2 + hum * Math.sin(now * 4.3 + 1),
      a3: p.a3 + hum * Math.sin(now * 6.2 + 2),
      grip: p.grip
    }, now);
  };

  function setPiston(p, a, b, cylLen) {
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    var ux = dx / d, uy = dy / d, c = Math.min(cylLen, d - 12);
    var cx = a.x + ux * c, cy = a.y + uy * c;
    p.cyl.setAttribute('x1', a.x); p.cyl.setAttribute('y1', a.y);
    p.cyl.setAttribute('x2', cx); p.cyl.setAttribute('y2', cy);
    p.cylhi.setAttribute('x1', a.x); p.cylhi.setAttribute('y1', a.y);
    p.cylhi.setAttribute('x2', cx); p.cylhi.setAttribute('y2', cy);
    p.rod.setAttribute('x1', cx); p.rod.setAttribute('y1', cy);
    p.rod.setAttribute('x2', b.x); p.rod.setAttribute('y2', b.y);
    p.ea.setAttribute('cx', a.x); p.ea.setAttribute('cy', a.y);
    p.eb.setAttribute('cx', b.x); p.eb.setAttribute('cy', b.y);
  }

  Arm.prototype.apply = function (pose) {
    var a1 = pose.a1, a2 = pose.a2, a3 = pose.a3, g = pose.grip;

    this.j1.setAttribute('transform', 'translate(' + SHOULDER.x + ' ' + SHOULDER.y + ') rotate(' + a1.toFixed(2) + ')');
    this.j2.setAttribute('transform', 'translate(0 ' + (-L1) + ') rotate(' + a2.toFixed(2) + ')');
    this.j3.setAttribute('transform', 'translate(0 ' + (-L2) + ') rotate(' + a3.toFixed(2) + ')');

    // gripper: g = 1 open, 0 closed
    var th = 5 + g * 30, ph = 4 + (1 - g) * 20;
    this.fl.setAttribute('transform', 'rotate(' + (-th).toFixed(2) + ')');
    this.flTip.setAttribute('transform', 'translate(0 -33) rotate(' + ph.toFixed(2) + ')');
    this.fr.setAttribute('transform', 'rotate(' + th.toFixed(2) + ')');
    this.frTip.setAttribute('transform', 'translate(0 -33) rotate(' + (-ph).toFixed(2) + ')');

    // elbow piston lives in upper-arm space: anchor on the upper arm,
    // other end on the underside of the forearm
    var pa = { x: 27, y: -122 };
    var pb = add(rot({ x: 27, y: -98 }, a2), { x: 0, y: -L1 });
    setPiston(this.p2, pa, pb, 108);

    // shoulder piston lives in world space: pedestal -> upper arm
    var wa = { x: 100, y: 686 };
    var wb = add(SHOULDER, rot({ x: 28, y: -72 }, a1));
    setPiston(this.p1, wa, wb, 78);

    // cable: pedestal -> top of upper arm, bulging outward
    var hA = { x: 40, y: 704 };
    var hB = add(SHOULDER, rot({ x: -24, y: -222 }, a1));
    var cx = Math.max(10, (hA.x + hB.x) / 2 - 40), cy = (hA.y + hB.y) / 2 + 12;
    var d = 'M' + hA.x + ' ' + hA.y + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + hB.x.toFixed(1) + ' ' + hB.y.toFixed(1);
    this.hose.setAttribute('d', d);
    this.hoseHi.setAttribute('d', d);
  };

  // ---- scene ----------------------------------------------------------
  function build() {
    if (!document.body.classList.contains('home-page')) return;
    if (document.querySelector('.garage-scene')) return;

    var scene = document.createElement('div');
    scene.className = 'garage-scene';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML =
      '<div class="garage-wall"></div>' +
      '<div class="garage-monitor garage-monitor--l"></div>' +
      '<div class="garage-monitor garage-monitor--r"></div>' +
      '<div class="garage-floor"></div>' +
      '<div class="garage-arm garage-arm--left"></div>' +
      '<div class="garage-arm garage-arm--right"></div>';
    document.body.insertBefore(scene, document.body.firstChild);

    var arms = [
      new Arm(scene.querySelector('.garage-arm--left'), 'L', 11),
      new Arm(scene.querySelector('.garage-arm--right'), 'R', 7)
    ];

    var start = performance.now();

    // Click an arm to make it choose a new pose.
    arms.forEach(function (arm, i) {
      var host = scene.querySelector(i === 0 ? '.garage-arm--left' : '.garage-arm--right');
      host.addEventListener('click', function () {
        arm.pick((performance.now() - start) / 1000);
        host.classList.remove('arm-tapped');
        void host.offsetWidth;
        host.classList.add('arm-tapped');
      });
    });

    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;   // leave both arms in their still pose

    // desync the two arms so they never move in lockstep
    arms[1].t0 = -1.3;
    function frame(ts) {
      var now = (ts - start) / 1000;
      for (var i = 0; i < arms.length; i++) arms[i].update(now);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
