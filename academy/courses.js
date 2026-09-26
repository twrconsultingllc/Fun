/* Full Circle Academy — course content.
 *
 * This is the one file to edit to add courses, lessons, words, pictures and
 * videos. Each lesson is a list of sections; a section can have:
 *
 *   heading   'Section title'
 *   text      ['Paragraph one.', 'Paragraph two.']
 *   bullets   ['Point', 'Point']
 *   tip       'A coaching tip shown in a green callout.'
 *   image     { art: 'pool' | 'bike' | 'run' | ... , caption: '...' }
 *             or { src: 'img/my-photo.jpg', alt: '...', caption: '...' }
 *   video     { youtube: 'VIDEO_ID', title: '...' }
 *             Leave youtube as '' to show an empty slot. On the page you can
 *             paste any YouTube link into that slot to preview it right away
 *             (saved in your browser only). To make it permanent for everyone,
 *             put the 11-character ID here, e.g. youtube: 'nC7sHUDj0Aw'.
 */
window.ACADEMY = {
    /* Featured on the landing page. */
    featured: { youtube: 'AH9EyOlW8ek', title: 'Full Circle Coaching' },
    courses: [
        {
            id: 'swim',
            name: 'Swim',
            color: 'var(--swim)',
            art: 'pool',
            level: 'Beginner → Intermediate',
            blurb: 'Breathe easy, hold a line and swim efficiently in pool and open water.',
            lessons: [
                {
                    title: 'Body Position & Balance',
                    summary: 'Why a flat, long body is the fastest free speed in the water.',
                    minutes: 12,
                    sections: [
                        {
                            heading: 'Why position comes first',
                            text: [
                                'Water is roughly 800 times denser than air, so drag — not fitness — is what slows most new triathletes down. Before we touch the pull or the kick, we get the body flat and long.',
                                'A swimmer whose hips and legs sink is effectively pushing a wall of water with their thighs on every stroke. Lift the hips and the same effort moves you noticeably farther.'
                            ],
                            image: { art: 'pool', caption: 'Aim for a straight line from the crown of your head to your heels.' }
                        },
                        {
                            heading: 'Head and hips',
                            text: ['Your head is the steering wheel for your hips. Look straight down at the pool floor, not forward — the back of your head should just break the surface.'],
                            bullets: [
                                'Eyes down, neck relaxed, water line at the crown',
                                'Press your chest gently into the water ("press the buoy")',
                                'Keep a light, steady kick from the hips, not the knees'
                            ],
                            tip: 'If your legs keep sinking, try a pull buoy for one length, then swim the next length trying to recreate that same feeling without it.'
                        },
                        {
                            heading: 'Watch it done',
                            text: ['A steady kick from the hips is what keeps the legs up. Watch Coach Erinne’s kick progression below, then try the drill set in the next section.'],
                            video: { youtube: '0Y2k_zehdyw', title: 'Best Flutter Kick Drill Progression for a Fast Efficient Freestyle Swim — Full Circle Coaching' }
                        },
                        {
                            heading: 'Drill set',
                            bullets: [
                                '4 × 25 m kick on your side, bottom arm extended',
                                '4 × 25 m "superman" glide and kick, face down',
                                '4 × 50 m easy freestyle, focus only on head position'
                            ]
                        }
                    ]
                },
                {
                    title: 'Breathing & Rhythm',
                    summary: 'Bilateral breathing, exhaling underwater and staying calm.',
                    minutes: 10,
                    sections: [
                        {
                            heading: 'Exhale under water',
                            text: ['Most "I can\'t get enough air" problems are really "I didn\'t breathe out" problems. Exhale steadily through your nose and mouth while your face is in the water, so the turn to breathe is only an inhale.'],
                            image: { art: 'breath', caption: 'Rotate with the body to breathe — one goggle stays in the water.' }
                        },
                        {
                            heading: 'Breathing pattern',
                            bullets: ['Every 3 strokes in training builds balance', 'Every 2 strokes is fine in races and hard efforts', 'Sight forward every 6–10 strokes in open water'],
                            video: { youtube: '', title: 'Bilateral breathing drill' }
                        }
                    ]
                },
                {
                    title: 'The Catch & Pull',
                    summary: 'Setting a high elbow so every stroke grips the water.',
                    minutes: 14,
                    sections: [
                        { heading: 'Early vertical forearm', text: ['After the hand enters, bend at the elbow and point your fingertips at the pool floor before you pull back. You are anchoring the hand and moving your body past it.'], video: { youtube: '', title: 'High-elbow catch' } }
                    ]
                },
                {
                    title: 'Open Water Skills',
                    summary: 'Sighting, drafting, and mass starts without panic.',
                    minutes: 15,
                    sections: [
                        { heading: 'Sighting', text: ['Lift only your eyes above the surface — "crocodile eyes" — then roll to breathe to the side. Pick a tall, fixed landmark behind the buoy.'], image: { art: 'openwater', caption: 'Sight on the landmark behind the buoy, not the buoy itself.' } },
                        { heading: 'Track your open water swim', text: ['Set your watch up before race day so your open water swims record distance and pace correctly.'], video: { youtube: 'a99Yimj7WL4', title: 'How to Use Your Garmin for Open Water Swimming — Full Circle Coaching' } }
                    ]
                }
            ]
        },
        {
            id: 'bike',
            name: 'Bike',
            color: 'var(--bike)',
            art: 'bike',
            level: 'All levels',
            blurb: 'Fit, cadence, gearing and pacing so you get off the bike ready to run.',
            lessons: [
                {
                    title: 'Bike Fit Basics',
                    summary: 'Saddle height, reach and why comfort is speed.',
                    minutes: 11,
                    sections: [
                        {
                            heading: 'Saddle height',
                            text: ['With your heel on the pedal at the bottom of the stroke, your leg should be straight. Clip in normally and you will have the slight knee bend you want.'],
                            image: { art: 'bike', caption: 'A slight bend at the knee at the bottom of the pedal stroke.' }
                        },
                        { heading: 'Know your bike', text: ['Before you adjust anything, get to know the parts of your bike and what each one does.'], video: { youtube: '4MK2mrfIif8', title: 'All About The Bike — Full Circle Coaching' } }
                    ]
                },
                { title: 'Cadence & Gearing', summary: 'Spin at 85–95 rpm and save your legs.', minutes: 9, sections: [
                    { heading: 'Find your cadence', text: ['Count right-foot pedal strokes for 30 seconds and double it. Aim for 85–95 on the flats.'] },
                    { heading: 'How many gears do you have?', text: ['Knowing your drivetrain makes gearing choices on hills and flats much easier.'], video: { youtube: 'LgptnFISzxs', title: 'How to Tell What Speed Bike You Have — Full Circle Coaching' } },
                    { heading: 'Read your cassette', video: { youtube: 'yF981RaeGoM', title: 'How to Know Your Cassette Size — Full Circle Coaching' } }
                ] },
                { title: 'Pacing the Bike Leg', summary: 'Ride by effort, not by ego.', minutes: 12, sections: [
                    { heading: 'Effort zones', bullets: ['Sprint: hard but controlled', 'Olympic: comfortably hard', '70.3 / Ironman: all-day steady'] },
                    { heading: 'Speed or power?', text: ['Speed changes with wind and hills; effort and power don’t. Pace the bike leg by the number that tells you how hard you are actually working.'], video: { youtube: '5Xr-hFQR9Bw', title: 'Do You Bike with Speed or Power? — Full Circle Coaching' } }
                ] }
            ]
        },
        {
            id: 'run',
            name: 'Run',
            color: 'var(--run)',
            art: 'run',
            level: 'All levels',
            blurb: 'Run form, brick workouts and running strong off the bike.',
            lessons: [
                {
                    title: 'Running Form',
                    summary: 'Posture, cadence and foot strike without overthinking it.',
                    minutes: 10,
                    sections: [
                        { heading: 'Tall and relaxed', text: ['Run tall with a slight forward lean from the ankles. Keep shoulders loose and arms swinging forward and back, not across your body.'], image: { art: 'run', caption: 'Land with your foot under your hips, not out in front.' }, video: { youtube: 'nC7sHUDj0Aw', title: 'Running Mechanics with Coach Erinne Guthrie — Full Circle Coaching' } },
                        { heading: 'Form drills', text: ['Short hopping drills teach a quick, springy ground contact.'], video: { youtube: 'zR0rH9T5A4E', title: 'Run Drills: Hopping — Coach Erinne Guthrie' } },
                        { heading: 'Lower-leg strength', text: ['Strong feet, ankles and calves absorb every landing. A few minutes of this a week goes a long way.'], video: { youtube: '4fcTS98a1D8', title: 'Lower Leg Strength — Coach Erinne Guthrie' } }
                    ]
                },
                { title: 'Brick Workouts', summary: 'Train the bike-to-run transition in your legs.', minutes: 8, sections: [{ heading: 'Your first brick', text: ['Ride 45 minutes easy, then run 10 minutes easy straight after. Heavy legs are normal — they ease within the first mile.'] }] },
                { title: 'Race-Day Run Pacing', summary: 'Start slower than you think.', minutes: 9, sections: [
                    { heading: 'The first mile', text: ['Aim to run the first mile 10–15 seconds per mile slower than goal pace, then settle in.'] },
                    { heading: 'Race shoes', text: ['Carbon-plated “super shoes” are everywhere. Here’s what they do, and don’t do, for a triathlete.'], video: { youtube: 'WZ1oShvjzi4', title: 'The Truth About Super Shoes in Triathlon — Full Circle Coaching' } }
                ] }
            ]
        },
        {
            id: 'transitions',
            name: 'Transitions',
            color: 'var(--t)',
            art: 'transition',
            level: 'Beginner',
            blurb: 'The fourth discipline: set up, move fast and never forget your helmet.',
            lessons: [
                { title: 'Setting Up Your Spot', summary: 'A minimal, repeatable transition layout.', minutes: 7, sections: [{ heading: 'Lay it out', bullets: ['Towel on the ground, shoes at the front', 'Helmet upside down on the aero bars, straps open', 'Sunglasses inside the helmet'], image: { art: 'transition', caption: 'Everything in the order you will use it.' } }] },
                { title: 'T1 & T2 Practice', summary: 'Rehearse until it is automatic.', minutes: 6, sections: [{ heading: 'Rehearse', video: { youtube: '', title: 'Fast transition walkthrough' } }] }
            ]
        },
        {
            id: 'fuel',
            name: 'Nutrition & Race Day',
            color: 'var(--fuel)',
            art: 'fuel',
            level: 'All levels',
            blurb: 'Fueling, hydration and a calm race-morning routine.',
            lessons: [
                { title: 'Fueling Basics', summary: 'Carbs per hour and practicing your plan.', minutes: 10, sections: [{ heading: 'Carbs per hour', text: ['For races over 90 minutes, most athletes need 60–90 g of carbohydrate per hour. Practice it in training — never try anything new on race day.'], image: { art: 'fuel', caption: 'Plan it, practice it, then race it.' } }] },
                { title: 'Race Morning', summary: 'A checklist that removes the stress.', minutes: 6, sections: [{ heading: 'Checklist', bullets: ['Eat 2–3 hours before the start', 'Body-mark, set up transition, walk the entries and exits', 'Warm up in the water if allowed'] },
                    { heading: 'Go deeper', text: ['The full Full Circle webinar on preparing for and racing your next triathlon.'], video: { youtube: 'aE6b_e8V2wc', title: 'Master Your Next Triathlon Webinar — Full Circle Coaching' } }
                ] }
            ]
        }
    ]
};

/* Illustrations — simple brand-colored SVG scenes used where a real photo
   will go later. Static strings only; nothing user-supplied is ever put here. */
window.ACADEMY_ART = {
    pool: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#0a1f3d"/><rect width="320" height="90" fill="#0b3a66" opacity=".6"/><g stroke="#29B6F6" stroke-opacity=".25" stroke-width="2"><path d="M0 45h320M0 90h320M0 135h320"/></g><g stroke="#fff" stroke-opacity=".08" stroke-width="10"><path d="M20 67h280M20 112h280"/></g><g fill="none" stroke="#7CB342" stroke-dasharray="4 8" stroke-width="2"><path d="M40 90h240"/></g><ellipse cx="170" cy="90" rx="62" ry="9" fill="#29B6F6" opacity=".25"/><circle cx="232" cy="88" r="9" fill="#FFB74D"/><path d="M110 90h110" stroke="#1976D2" stroke-width="12" stroke-linecap="round"/><path d="M225 84l38-14" stroke="#1976D2" stroke-width="7" stroke-linecap="round"/><path d="M112 90l-24 4" stroke="#1976D2" stroke-width="7" stroke-linecap="round"/><g fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"><path d="M60 100q10-6 20 0t20 0M250 100q10-6 20 0t20 0"/></g></svg>',
    breath: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#0a1f3d"/><rect y="95" width="320" height="85" fill="#0b3a66"/><path d="M0 95q20-8 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0" fill="none" stroke="#29B6F6" stroke-width="3"/><circle cx="160" cy="92" r="30" fill="#FFB74D"/><circle cx="150" cy="84" r="6" fill="#0a1f3d"/><path d="M130 92h60" stroke="#1976D2" stroke-width="6"/><g fill="#fff" opacity=".5"><circle cx="190" cy="130" r="4"/><circle cx="200" cy="145" r="3"/><circle cx="186" cy="155" r="5"/><circle cx="205" cy="165" r="2.5"/></g><text x="230" y="60" fill="#7CB342" font-family="Inter,sans-serif" font-weight="800" font-size="14">INHALE</text><text x="220" y="150" fill="#29B6F6" font-family="Inter,sans-serif" font-weight="800" font-size="14">EXHALE</text></svg>',
    openwater: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#1a2c4f"/><circle cx="260" cy="40" r="18" fill="#FFB74D" opacity=".8"/><path d="M0 95l40-30 30 20 40-40 50 50 40-25 50 30 70-15v10H0z" fill="#0f1a33"/><rect y="100" width="320" height="80" fill="#0b3a66"/><path d="M0 110q20-6 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0M0 135q20-6 40 0t40 0 40 0 40 0 40 0 40 0 40 0 40 0" fill="none" stroke="#29B6F6" stroke-opacity=".35" stroke-width="2"/><path d="M180 110l10-28 10 28z" fill="#FF7043"/><rect x="178" y="108" width="24" height="6" rx="3" fill="#FF7043"/><path d="M60 150h60" stroke="#1976D2" stroke-width="10" stroke-linecap="round"/><circle cx="126" cy="148" r="7" fill="#FFB74D"/><path d="M130 146l50-36" stroke="#7CB342" stroke-dasharray="3 5" stroke-width="2"/></svg>',
    bike: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#0f1f16"/><path d="M0 140h320" stroke="#334155" stroke-width="18"/><path d="M0 140h320" stroke="#7CB342" stroke-dasharray="18 14" stroke-width="2"/><g fill="none" stroke="#e2e8f0" stroke-width="5"><circle cx="100" cy="112" r="28"/><circle cx="220" cy="112" r="28"/></g><g fill="none" stroke="#7CB342" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"><path d="M100 112l40-40h55l25 40M140 72l20 40 35-40M160 112l-60 0"/><path d="M190 60h18"/><path d="M132 66h20"/></g><circle cx="160" cy="112" r="6" fill="#1976D2"/><circle cx="168" cy="44" r="9" fill="#FFB74D"/><path d="M165 54l-20 16 30 6" fill="none" stroke="#1976D2" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    run: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#2a1a0e"/><g fill="#3b2412"><path d="M0 150h320v30H0z"/></g><g stroke="#FFB74D" stroke-opacity=".4" stroke-width="2"><path d="M0 150h320M0 165h320"/></g><circle cx="170" cy="42" r="11" fill="#FFB74D"/><g fill="none" stroke="#1976D2" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M166 56l-10 40"/><path d="M156 96l24 18 -6 34"/><path d="M156 96l-20 22 -22 6"/><path d="M164 64l20 16 14-8"/><path d="M162 66l-22 10 -8 18"/></g><path d="M60 110h40M40 125h50M70 95h30" stroke="#7CB342" stroke-width="3" stroke-linecap="round" opacity=".7"/></svg>',
    transition: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#1d1230"/><path d="M0 130h320" stroke="#475569" stroke-width="4"/><rect x="60" y="130" width="200" height="40" rx="4" fill="#BA68C8" opacity=".35"/><path d="M90 150h30l6-10h-20z" fill="#e2e8f0"/><path d="M190 150h30l6-10h-20z" fill="#e2e8f0"/><path d="M130 120a30 22 0 0 1 60 0z" fill="#1976D2"/><path d="M140 120h40" stroke="#7CB342" stroke-width="3"/><g fill="none" stroke="#94a3b8" stroke-width="4"><path d="M40 60h240"/><path d="M60 60v70M260 60v70"/></g><text x="250" y="40" text-anchor="middle" fill="#BA68C8" font-family="Inter,sans-serif" font-weight="900" font-size="16" letter-spacing="4">T1 · T2</text></svg>',
    fuel: '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="320" height="180" fill="#2a0f12"/><rect x="80" y="40" width="44" height="110" rx="12" fill="#1976D2"/><rect x="88" y="30" width="28" height="14" rx="4" fill="#7CB342"/><rect x="86" y="80" width="32" height="30" rx="4" fill="#fff" opacity=".2"/><rect x="150" y="70" width="90" height="36" rx="8" fill="#EF5350"/><path d="M150 88h90" stroke="#fff" stroke-opacity=".3" stroke-width="2"/><rect x="160" y="118" width="60" height="30" rx="6" fill="#FFB74D"/><text x="275" y="150" text-anchor="middle" fill="#fca5a5" font-family="Inter,sans-serif" font-weight="800" font-size="13">60–90 g/hr</text></svg>'
};
