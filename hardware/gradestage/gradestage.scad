// ============================================================================
// GradeStage — card imaging & pre-grading rig                © 2026 DarkHearts
// ============================================================================
// Parametric OpenSCAD. Print parts on any 180x180mm+ bed in PLA/PETG.
// Open in OpenSCAD (free, openscad.org) → set `part` below → F6 → Export STL.
//
// PARTS
//   "base"    — the stage: recessed card bay (raw card, penny sleeve, or
//               Card Saver 1), engraved centering crosshairs, LED-bar sockets
//               at 20° (raking — reveals print lines/scratches) and 45°
//               (even illumination — color/centering shots), rubber-foot dimples.
//   "ledbar"  — snap-in bar holding a 10mm COB/strip LED segment (print 2).
//   "column"  — stackable tower column (print 4 for ~240mm camera height).
//   "bridge"  — phone crossbar that sits on two column stacks; slot keeps the
//               phone camera centered over the card bay.
//   "all"     — plated layout preview.
// ============================================================================

part = "all"; // ["base","ledbar","column","bridge","all"]

/* ------------------------------- core dims ------------------------------- */
card_w      = 63.5;   // raw card
card_h      = 88.9;
saver_w     = 66.8;   // Card Saver 1 envelope (graded-prep standard)
saver_h     = 93.8;
bay_tol     = 0.6;    // fit clearance
bay_depth   = 1.4;    // shallow so raking light grazes the surface

base_w      = 170;
base_d      = 150;
base_t      = 6;

led_len     = 110;    // LED strip segment length the bar carries
led_w       = 11;     // strip width (10mm COB + clearance)
bar_t       = 3;

rake_angle  = 20;     // raking light angle (surface-defect hunting)
even_angle  = 45;     // even-light angle (color & centering shots)

col_w       = 18;     // tower column square section
col_h       = 60;     // per-section height (stack 4 = 240mm lens height)
peg         = 8;      // stacking peg
bridge_len  = 220;    // spans the stage
phone_slot  = 13;     // fits phones up to ~12.5mm thick w/ case

$fn = 48;

/* --------------------------------- base ---------------------------------- */
module crosshair(l = 8, t = 0.8, depth = 0.5) {
  translate([-l/2, -t/2, -depth]) cube([l, t, depth + 0.01]);
  translate([-t/2, -l/2, -depth]) cube([t, l, depth + 0.01]);
}

module led_socket() {
  // dovetail-ish slot pair a led-bar tongue drops into
  cube([14, 6.4, 5], center = true);
}

module base() {
  difference() {
    // plate with rounded corners
    minkowski() {
      cube([base_w - 12, base_d - 12, base_t - 1], center = true);
      cylinder(r = 6, h = 1, center = true);
    }
    // card bay — sized for Card Saver 1; engraved inner outline marks raw card
    translate([0, 0, base_t/2 - bay_depth/2 + 0.01])
      cube([saver_w + bay_tol, saver_h + bay_tol, bay_depth + 0.02], center = true);
    // raw-card outline engraving inside the bay floor
    translate([0, 0, base_t/2 - bay_depth - 0.4]) difference() {
      cube([card_w + 0.8, card_h + 0.8, 0.5], center = true);
      cube([card_w - 0.8, card_h - 0.8, 0.6], center = true);
    }
    // centering crosshairs at bay mid-edges (line phone gridlines up to these)
    for (p = [[0,  (saver_h + bay_tol)/2 + 5], [0, -(saver_h + bay_tol)/2 - 5]])
      translate([p[0], p[1], base_t/2]) crosshair();
    for (p = [[ (saver_w + bay_tol)/2 + 5, 0], [-(saver_w + bay_tol)/2 - 5, 0]])
      translate([p[0], p[1], base_t/2]) crosshair();
    // finger notch to lift the card
    translate([0, -(saver_h + bay_tol)/2, base_t/2 - bay_depth])
      cylinder(d = 18, h = bay_depth + 0.01);
    // LED-bar sockets: one pair per side per angle (marked R=raking, E=even)
    for (s = [-1, 1]) {
      translate([s * (saver_w/2 + 22), 0, base_t/2 - 2.5]) led_socket();          // raking
      translate([s * (saver_w/2 + 38), 0, base_t/2 - 2.5]) led_socket();          // even
    }
    // tower column sockets (rear corners + front corners)
    for (x = [-1, 1], y = [-1, 1])
      translate([x * (base_w/2 - 16), y * (base_d/2 - 16), base_t/2 - 4])
        cube([col_w + 0.5, col_w + 0.5, 4.01], center = true);
    // rubber-foot dimples
    for (x = [-1, 1], y = [-1, 1])
      translate([x * (base_w/2 - 12), y * (base_d/2 - 12), -base_t/2])
        cylinder(d = 8, h = 1);
  }
}

/* -------------------------------- led bar -------------------------------- */
module ledbar(angle = rake_angle) {
  // tongue that drops into a base socket
  translate([0, 0, 2.5]) cube([13.6, 6, 5], center = true);
  // angled mast + channel for the LED strip, wire exit at one end
  translate([0, 0, 5]) rotate([angle, 0, 0]) difference() {
    union() {
      translate([-led_len/2, -2, 0]) cube([led_len, 4, 26]);
      translate([-led_len/2, -8, 22]) cube([led_len, 16, 6]);  // strip shelf
    }
    translate([-led_len/2 - 0.01, -led_w/2, 23.2]) cube([led_len + 0.02, led_w, 3.2]);
    translate([led_len/2 - 8, 0, 24]) rotate([90, 0, 0]) cylinder(d = 4, h = 20, center = true); // wire exit
  }
}

/* --------------------------------- tower --------------------------------- */
module column() {
  difference() {
    cube([col_w, col_w, col_h], center = false);
    translate([col_w/2, col_w/2, col_h - peg/2 + 0.01])
      cube([peg + 0.5, peg + 0.5, peg + 0.02], center = true);  // top socket
  }
  translate([col_w/2, col_w/2, 0])
    cube([peg, peg, peg], center = true); // bottom peg (4mm proud) mates next section / base socket
}

module bridge() {
  difference() {
    cube([bridge_len, 50, 8], center = true);
    // phone slot with camera window
    translate([0, 8, 0]) cube([bridge_len - 40, phone_slot, 8.01], center = true);
    translate([0, -10, 0]) cube([70, 26, 8.01], center = true); // camera window over the bay
  }
  // end caps that seat on column stacks
  for (s = [-1, 1]) translate([s * (bridge_len/2 - col_w/2), 0, -8]) difference() {
    cube([col_w + 8, col_w + 8, 8], center = true);
    translate([0, 0, -2]) cube([col_w + 0.6, col_w + 0.6, 6], center = true);
  }
}

/* --------------------------------- plate --------------------------------- */
if (part == "base") base();
if (part == "ledbar") ledbar();
if (part == "column") column();
if (part == "bridge") bridge();
if (part == "all") {
  base();
  translate([0, base_d/2 + 50, 0]) ledbar(rake_angle);
  translate([0, base_d/2 + 110, 0]) ledbar(even_angle);
  translate([base_w/2 + 40, -40, 0]) column();
  translate([base_w/2 + 80, 60, 0]) bridge();
}
