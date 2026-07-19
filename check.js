#!/usr/bin/env node
/*
 * Thames Lido "Swim & Lunch" availability checker.
 *
 * Drives the REAL SevenRooms booking widget in a headless browser and reads the
 * calendar exactly as a human would. The underlying JSON endpoints do NOT cleanly
 * expose which dates are bookable; only the rendered calendar reflects true
 * per-date, per-party availability (bookable days are normal, unavailable days are
 * struck through).
 *
 * Usage:
 *   node check.js                         # 4 and 6 guests on 2026-08-31
 *   node check.js --date 2026-07-23 --party 2
 *   node check.js --party 4,6 --month     # also list every open date in that month
 *   node check.js --headed                # watch the browser (local only)
 *
 * Env:
 *   PLAYWRIGHT_CHANNEL=chrome             # use installed Chrome (local). On CI,
 *                                         # leave unset to use Playwright's Chromium.
 *
 * Exit code 0 if any requested party size is bookable on the date, 1 if not, 3 on error.
 */
const { chromium } = require('playwright');

const MONTHS = ['January','February','March','April','May','June','July',
                'August','September','October','November','December'];
const ORD = n => n + (n%10===1&&n!==11?'st':n%10===2&&n!==12?'nd':n%10===3&&n!==13?'rd':'th');

function parseArgs(argv) {
  const a = { date: process.env.WATCH_DATE || '2026-08-31',
    party: (process.env.WATCH_PARTY || '4,6').split(',').map(s=>parseInt(s.trim(),10)),
    headed: false, month: false,
    url: 'https://www.sevenrooms.com/experiences/thameslido/swim-lunch-2026-6037758771150848?client_id=359a9c4208b7bd261518fecb74843866d49352e027ec27f023cd426491034af877c4f33839aa8baaa2dd69fb23550ad88d75e475c59255f9fe34f2f4bc3c7954' };
  for (let i=0;i<argv.length;i++){
    const k = argv[i];
    if (k==='--date') a.date = argv[++i];
    else if (k==='--party') a.party = argv[++i].split(',').map(s=>parseInt(s.trim(),10));
    else if (k==='--headed') a.headed = true;
    else if (k==='--month') a.month = true;
    else if (k==='--url') a.url = argv[++i];
  }
  return a;
}

async function getResFrame(page) {
  await page.waitForTimeout(500);
  for (let i=0;i<20;i++){
    const f = page.frames().find(fr => fr.url().includes('/reservations/'));
    if (f) return f;
    await page.waitForTimeout(500);
  }
  throw new Error('reservation widget frame never appeared');
}

async function currentGuests(f) {
  return await f.evaluate(() => {
    const inc = document.querySelector('[aria-label="increment Guests"]');
    let node = inc;
    for (let i=0;i<5 && node;i++){ node = node.parentElement;
      if (node){ const m = node.textContent.match(/(\d+)\s*Guest/i); if (m) return parseInt(m[1],10); }
    }
    return null;
  });
}

async function clickLabel(f, label) {
  const ok = await f.evaluate((label) => {
    const el = document.querySelector(`[aria-label="${label}"]`);
    if (!el || el.disabled || el.getAttribute('aria-disabled')==='true') return false;
    el.click(); return true;
  }, label);
  await f.page().waitForTimeout(450);
  return ok;
}

async function setGuests(f, target) {
  for (let i=0;i<12;i++){
    const cur = await currentGuests(f);
    if (cur === target || cur === null) return cur;
    const label = cur < target ? 'increment Guests' : 'decrement Guests';
    const ok = await clickLabel(f, label);
    if (!ok) return cur; // hit the cap / control disabled
  }
  return await currentGuests(f);
}

async function currentMonth(f) {
  return await f.evaluate(() => {
    const re = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+20\d\d$/;
    const el = [...document.querySelectorAll('*')]
      .find(e => e.children.length===0 && re.test((e.textContent||'').trim()));
    return el ? el.textContent.trim() : '';
  });
}

async function gotoMonth(f, targetLabel) {
  for (let i=0;i<24;i++){
    const cur = await currentMonth(f);
    if (cur === targetLabel) return true;
    const [tm,ty] = targetLabel.split(' '); const [cm,cy] = cur.split(' ');
    const tIdx = MONTHS.indexOf(tm) + 12*parseInt(ty,10);
    const cIdx = MONTHS.indexOf(cm) + 12*parseInt(cy,10);
    const label = tIdx > cIdx ? 'increment month' : 'decrement month';
    const ok = await clickLabel(f, label);
    if (!ok) return false;
    await f.page().waitForTimeout(300);
  }
  return (await currentMonth(f)) === targetLabel;
}

// A day is bookable if its cell is present in the current month and NOT struck through.
async function dayState(f, monthName, dayNum) {
  const needle = `${monthName} ${ORD(dayNum)} `; // e.g. "August 31st "
  return await f.evaluate((needle) => {
    const tds = [...document.querySelectorAll('td')];
    const cell = tds.find(td => (td.getAttribute('aria-label')||'').includes(needle));
    if (!cell) return { found:false };
    const s = getComputedStyle(cell);
    const struck = s.textDecorationLine.includes('line-through');
    return { found:true, struck, aria: cell.getAttribute('aria-label') };
  }, needle);
}

async function openTimes(f, monthName, dayNum) {
  const needle = `${monthName} ${ORD(dayNum)} `;
  try {
    await f.evaluate((needle) => {
      const td = [...document.querySelectorAll('td')]
        .find(td => (td.getAttribute('aria-label')||'').includes(needle));
      if (td) (td.querySelector('*') || td).click();
    }, needle);
    await f.page().waitForTimeout(2500);
    return await f.evaluate(() => {
      const out = [];
      document.querySelectorAll('button,[role=button],a,div').forEach(b => {
        if (b.children.length > 1) return;
        const t = (b.textContent||'').trim();
        if (/^\d{1,2}:\d{2}/.test(t)) out.push(t.replace(/\s+/g,' ').slice(0,60));
      });
      return [...new Set(out)];
    });
  } catch (e) { return []; }
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const [Y,M,D] = args.date.split('-').map(n=>parseInt(n,10));
  const monthName = MONTHS[M-1];
  const monthLabel = `${monthName} ${Y}`;
  const dateH = `${ORD(D)} ${monthName} ${Y}`;

  const launchOpts = { headless: !args.headed };
  if (process.env.PLAYWRIGHT_CHANNEL) launchOpts.channel = process.env.PLAYWRIGHT_CHANNEL;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage({ viewport:{width:1200,height:1000}, userAgent:'Mozilla/5.0' });

  console.log(`Thames Lido — Swim & Lunch availability for ${dateH}`);
  console.log('-'.repeat(60));

  let anyFound = false;
  try {
    await page.goto(args.url, { waitUntil:'networkidle', timeout:60000 });
    await page.waitForTimeout(2000);
    await page.getByText('Book Now',{exact:false}).first().click({timeout:15000});
    const f = await getResFrame(page);
    await page.waitForTimeout(2500);

    for (const ps of args.party) {
      const setTo = await setGuests(f, ps);
      if (setTo !== ps) {
        console.log(`  Party of ${ps}:  not offered (widget caps at ${setTo} guests)`);
        continue;
      }
      await gotoMonth(f, monthLabel);
      await page.waitForTimeout(500);
      const st = await dayState(f, monthName, D);
      if (!st.found) {
        console.log(`  Party of ${ps}:  ${dateH} not shown in calendar`);
      } else if (st.struck) {
        console.log(`  Party of ${ps}:  NOT available`);
      } else {
        anyFound = true;
        const times = await openTimes(f, monthName, D);
        const tstr = times.length ? '  →  ' + times.join('  |  ') : '';
        console.log(`  Party of ${ps}:  AVAILABLE${tstr}`);
      }

      if (args.month) {
        const open = await f.evaluate((monthName) => {
          const out=[];
          document.querySelectorAll('td').forEach(td=>{
            const al=td.getAttribute('aria-label')||'';
            if (al.includes(monthName) && al.includes('2026')){
              const s=getComputedStyle(td);
              if(!s.textDecorationLine.includes('line-through')){
                const m=al.match(/(\d{1,2})(st|nd|rd|th)/);
                if(m) out.push(parseInt(m[1],10));
              }
            }
          });
          return [...new Set(out)].sort((a,b)=>a-b);
        }, monthName);
        console.log(`             open ${monthName} dates for ${ps}: ${open.length?open.join(', '):'(none)'}`);
      }
    }
  } catch (e) {
    console.error('check failed:', e.message);
    await browser.close();
    process.exit(3);
  }

  console.log('-'.repeat(60));
  console.log(anyFound ? 'Book here:\n  ' + args.url.split('?')[0]
                       : 'Nothing bookable for the requested party size(s) on this date.');
  await browser.close();
  process.exit(anyFound ? 0 : 1);
})();
