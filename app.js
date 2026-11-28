/* ماشین زمان — logic
   Reads history.json (TGJU price history, built by build_history.py) and
   static_data.json (housing + deposit rates), then answers:
   "I had X toman in year 1370 — what is it worth today in each market?"        */
(function () {
  'use strict';

  var HISTORY = null;
  var STATIC = null;

  var $ = function (id) { return document.getElementById(id); };
  var yearEl = $('year'), amountEl = $('amount'), resultsEl = $('results');

  /* ---------- formatting ---------- */
  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
  function faNum(n) {
    return String(n).replace(/[0-9]/g, function (d) { return FA_DIGITS[+d]; });
  }
  function faDigitsOnly(n) {
    return String(n).replace(/[0-9]/g, function (d) { return FA_DIGITS[+d]; });
  }
  function toman(v) {
    if (v == null || !isFinite(v)) return '—';
    if (Math.abs(v) >= 1e12) return faDigitsOnly((v / 1e12).toFixed(2)) + ' هزار میلیارد';
    if (Math.abs(v) >= 1e9) return faDigitsOnly((v / 1e9).toFixed(2)) + ' میلیارد';
    if (Math.abs(v) >= 1e6) return faDigitsOnly((v / 1e6).toFixed(2)) + ' میلیون';
    if (Math.abs(v) >= 1e3) return faDigitsOnly(Math.round(v).toLocaleString('en-US'));
    return faDigitsOnly(Math.round(v));
  }
  function tomanFull(v) {
    if (v == null || !isFinite(v)) return '—';
    return faDigitsOnly(Math.round(v).toLocaleString('en-US'));
  }
  function numMult(v) {
    if (v == null || !isFinite(v)) return '—';
    if (v >= 1000) return faDigitsOnly(Math.round(v).toLocaleString('en-US')) + '×';
    if (v >= 100) return faDigitsOnly(v.toFixed(0)) + '×';
    if (v >= 10) return faDigitsOnly(v.toFixed(1).replace('.', ',')) + '×';
    return faDigitsOnly(v.toFixed(2).replace('.', ',')) + '×';
  }

  /* ---------- input parsing (accepts Persian and Latin digits) ---------- */
  function parseAmount(s) {
    if (!s) return NaN;
    var latin = String(s).replace(/[۰-۹]/g, function (c) {
      return FA_DIGITS.indexOf(c);
    }).replace(/[٠-٩]/g, function (c) {
      return '٠١٢٣٤٥٦٧٨٩'.indexOf(c);
    });
    var cleaned = latin.replace(/[^\d.]/g, '');
    if (!cleaned) return NaN;
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : NaN;
  }
  /* Persian digits with thousands separators, for display in the input */
  function formatAmountInput(n) {
    var s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return faDigitsOnly(s);
  }

  /* ---------- data access ---------- */
  function yearsAvailable() {
    // union of all years that have at least one asset
    var set = {};
    if (HISTORY) {
      Object.keys(HISTORY.assets).forEach(function (k) {
        var a = HISTORY.assets[k];
        for (var y = a.y_min; y <= a.y_max; y++) { set[y] = true; }
      });
    }
    if (STATIC) {
      Object.keys(STATIC.housing_tehran.prices).forEach(function (y) { set[y] = true; });
      Object.keys(STATIC.deposit_rates.rates).forEach(function (y) { set[y] = true; });
      if (STATIC.wages && STATIC.wages.years) {
        Object.keys(STATIC.wages.years).forEach(function (y) { set[y] = true; });
      }
    }
    return Object.keys(set).map(Number).sort(function (a, b) { return b - a; });
  }

  /* price of an asset at a given Jalali year (Toman per unit) */
  function priceAt(assetKey, year) {
    if (assetKey === 'housing') {
      var hp = STATIC.housing_tehran.prices;
      var p = hp[String(year)];
      if (p != null) return p;
      // the table may not cover the current year yet -> use the latest entry
      var hy = Object.keys(hp).map(Number).sort(function (a, b) { return b - a; });
      for (var i = 0; i < hy.length; i++) {
        if (hy[i] <= year) return hp[String(hy[i])];
      }
      return null;
    }
    var a = HISTORY.assets[assetKey];
    if (!a) return null;
    var y = a.years[String(year)];
    if (!y) return null;
    // for the current year use the live price, otherwise the year-end close
    if (String(year) === String(a.y_max)) return a.latest;
    return y.end;
  }

  /* current value of `amount` toman invested in `assetKey` in `year` */
  function evaluate(assetKey, year, amount) {
    if (assetKey === 'deposit') {
      // compound at the official 1-year deposit rate for every year since
      var rate = STATIC.deposit_rates.rates[String(year)];
      if (rate == null) return null;
      var finalYear = Math.max.apply(null, yearsAvailable());
      var yrs = finalYear - year;
      var v = amount;
      for (var i = 0; i < yrs; i++) {
        var r = STATIC.deposit_rates.rates[String(year + i + 1)];
        if (r == null) r = 15;
        v *= (1 + r / 100);
      }
      return { value: v, unit: 'تومان', priceNow: null, priceThen: null,
               rateLabel: faDigitsOnly(rate) + '٪' };
    }
    var pThen = priceAt(assetKey, year);
    var pNow = priceAt(assetKey, Math.max(...yearsAvailable()));
    if (!pThen || !pNow || pThen <= 0) return null;
    var units = amount / pThen;
    return { value: units * pNow, unit: null, priceThen: pThen, priceNow: pNow };
  }

  /* ---------- wage gradient box ---------- */
  function renderWage(year) {
    var box = $('wageBox');
    if (!STATIC || !STATIC.wages) { box.hidden = true; return; }
    var wy = STATIC.wages.years;
    var y = String(year);
    if (!wy[y]) { box.hidden = true; return; }
    box.hidden = false;

    var val = wy[y];
    var cur = Math.max.apply(null, Object.keys(wy).map(Number));
    var curVal = wy[String(cur)] || val;

    // position on a LOG scale between the first and the current wage —
    // linear would squash every early year into the far left
    var lo = wy[String(Math.min.apply(null, Object.keys(wy).map(Number)))];
    var hi = curVal;
    var t = hi > lo
      ? (Math.log(Math.max(val, lo)) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
      : 1;
    t = Math.max(0.015, Math.min(1, t));

    $('wageYear').textContent = faDigitsOnly(y);
    $('wageSub').textContent = 'حداقل دستمزد ماهانه';
    $('wageFill').style.width = (t * 100) + '%';
    $('wageKnob').style.right = (t * 100) + '%';
    var ro = $('wageReadout');
    ro.textContent = tomanFull(val) + ' تومان';
    // keep the readout inside the track (it is centred on the knob)
    var pct = t * 100;
    ro.style.right = Math.max(9, Math.min(91, pct)) + '%';

    $('wageMin').textContent = tomanFull(lo) + ' تومان';
    $('wageMax').textContent = tomanFull(hi) + ' تومان';

    var inf = STATIC.wages.inflation && STATIC.wages.inflation[y];
    var note = 'پایه حقوق ماهانه (حداقل دستمزد) در سال ' + faDigitsOnly(y) +
      ' برابر <b>' + tomanFull(val) + '</b> تومان بوده' +
      (inf ? ' — تورم آن سال <b>' + faDigitsOnly(inf) + '٪</b> بوده' : '') + '.';
    if (curVal > val) {
      var mult = curVal / val;
      note += ' امروز حداقل دستمزد <b>' + tomanFull(curVal) +
        '</b> تومان است، یعنی <b>' + numMult(mult) + '</b> آن زمان.';
    }
    $('wageNote').innerHTML = note;
  }

  /* ---------- render ---------- */
  function render() {
    var year = parseInt(yearEl.value, 10);
    var amount = parseAmount(amountEl.value);
    resultsEl.innerHTML = '';
    renderWage(year);

    if (!isFinite(amount) || amount <= 0) {
      resultsEl.innerHTML = '<div class="empty">مبلغ معتبر وارد کنید</div>';
      return;
    }
    if (!HISTORY || !STATIC) {
      resultsEl.innerHTML = '<div class="empty">در حال بارگذاری داده‌ها…</div>';
      return;
    }

    var order = ['coin', 'gold18', 'usd', 'housing', 'deposit'];
    var rows = [];
    order.forEach(function (key) {
      var meta = STATIC.assets[key];
      var r = evaluate(key, year, amount);
      if (!r) return;
      var mult = r.value / amount;
      rows.push({ key: key, meta: meta, r: r, mult: mult });
    });

    if (!rows.length) {
      resultsEl.innerHTML = '<div class="empty">برای این سال داده‌ای موجود نیست</div>';
      return;
    }

    // best / worst by multiplier
    var sorted = rows.slice().sort(function (a, b) { return b.mult - a.mult; });
    var bestKey = sorted[0].key, worstKey = sorted[sorted.length - 1].key;
    var maxMult = Math.max.apply(null, rows.map(function (x) { return x.mult; }));
    var minMult = Math.min.apply(null, rows.map(function (x) { return x.mult; }));

    rows.forEach(function (row) {
      var el = document.createElement('div');
      el.className = 'row' + (row.key === bestKey ? ' top' : '');

      var unitInfo = '';
      if (row.key === 'deposit') {
        unitInfo = '';
      } else if (row.r.unit) {
        unitInfo = '';
      }

      // how many units you would hold
      var units = null;
      if (row.key !== 'deposit' && row.r.priceThen) {
        units = amount / row.r.priceThen;
      }

      var priceLine = '';
      if (row.key === 'deposit') {
        // the deposit row is a compound rate, so express it per 1,000 toman too
        var depPer1k = 1000 * (row.r.value / amount);
        priceLine = 'هر ۱,۰۰۰ تومان آن سال = <b>' + tomanFull(depPer1k) + '</b> تومان امروز' +
                    '<br>نرخ سود سپرده یک‌ساله در آن سال: <b>' + row.r.rateLabel + '</b>';
      } else {
        var uTxt = units == null ? '' :
          (units >= 1 ? faDigitsOnly(units.toFixed(units >= 100 ? 0 : 2)) + ' ' + row.meta.unit
                       : faDigitsOnly((units * 1000).toFixed(2)) + ' هزار ' + row.meta.unit);
        // the "per 1,000 toman" value — independent of the amount the user typed
        var per1k = (1000 / row.r.priceThen) * row.r.priceNow;
        priceLine = 'هر ۱,۰۰۰ تومان آن سال = <b>' + tomanFull(per1k) + '</b> تومان امروز' +
                    '<br>قیمت آن سال: <b>' + tomanFull(row.r.priceThen) + '</b> تومان' +
                    (uTxt ? ' · تعداد: <b>' + uTxt + '</b>' : '');
      }

      var pct = (row.mult - 1) * 100;
      var badge = '';
      if (row.key === bestKey && rows.length > 1) {
        badge = '<span class="badge best">بهترین بازده</span>';
      } else if (row.key === worstKey && rows.length > 1) {
        badge = '<span class="badge worst">ضعیف‌ترین بازده</span>';
      }

      // bar width: relative to the best performer (min 4% so a small value
      // still reads as "a bar", not as a broken/absent bar)
      var pctOfMax = maxMult > 0 ? Math.max(4, Math.min(100, (row.mult / maxMult) * 100)) : 100;

      el.innerHTML =
        '<div class="icon">' + row.meta.icon + '</div>' +
        '<div class="name">' + row.meta.label +
          '<small>' + row.meta.label_en + '</small>' + badge + '</div>' +
        '<div class="bar-cell">' +
          '<div class="bar"><i class="' + (row.mult < 1 ? 'neg' : '') +
            '" style="width:' + pctOfMax + '%"></i></div>' +
          '<div class="now">' + priceLine + '</div>' +
        '</div>' +
        '<div class="mult">' +
          '<div class="m' + (row.mult < 1 ? ' neg' : '') + '">' + toman(row.r.value) + '</div>' +
          '<div class="pct">' + numMult(row.mult) + ' · ' +
            (pct >= 0 ? '+' : '') + faDigitsOnly(pct.toFixed(pct >= 1000 ? 0 : 1)) + '٪</div>' +
        '</div>';
      resultsEl.appendChild(el);
    });

    // summary line
    var sum = document.createElement('div');
    sum.className = 'row';
    sum.style.background = 'transparent';
    sum.style.borderStyle = 'dashed';
    sum.innerHTML =
      '<div class="icon">📊</div>' +
      '<div class="name">خلاصه' + '<small>سال ' + faDigitsOnly(year) + ' · ' +
        tomanFull(amount) + ' تومان</small></div>' +
      '<div class="bar-cell"><div class="now">' +
        'بهترین: <b>' + sorted[0].meta.label + '</b> (' + numMult(sorted[0].mult) + ')' +
        ' &nbsp;·&nbsp; ضعیف‌ترین: <b>' + sorted[sorted.length - 1].meta.label + '</b> (' +
        numMult(sorted[sorted.length - 1].mult) + ')' +
        '</div></div>' +
      '<div class="mult"><div class="m">' + numMult(maxMult) + '</div>' +
      '<div class="pct">بیشترین ضریب</div></div>';
    resultsEl.appendChild(sum);
  }

  /* ---------- init ---------- */
  function fillYears() {
    var ys = yearsAvailable();
    yearEl.innerHTML = '';
    ys.forEach(function (y) {
      var o = document.createElement('option');
      o.value = String(y);
      o.textContent = faDigitsOnly(y);
      yearEl.appendChild(o);
    });
    // default: 1370 (the user's example)
    if (ys.indexOf(1370) >= 0) yearEl.value = '1370';
    else yearEl.value = String(ys[ys.length - 1]);
    updateHint();
  }

  function updateHint() {
    var y = parseInt(yearEl.value, 10);
    var cur = Math.max.apply(null, yearsAvailable());
    var n = cur - y;
    $('yearHint').textContent = n > 0
      ? faDigitsOnly(n) + ' سال گذشته — ارزش امروز محاسبه می‌شود'
      : 'سال جاری';
  }

  yearEl.addEventListener('change', function () { updateHint(); render(); });
  amountEl.addEventListener('input', function () { render(); });
  amountEl.addEventListener('blur', function () {
    var n = parseAmount(amountEl.value);
    if (isFinite(n) && n > 0) amountEl.value = formatAmountInput(n);
    render();
  });
  document.querySelectorAll('.quick button').forEach(function (b) {
    b.addEventListener('click', function () {
      amountEl.value = formatAmountInput(parseInt(b.getAttribute('data-amt'), 10));
      render();
    });
  });

  Promise.all([
    fetch('history.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('history.json: HTTP ' + r.status);
      return r.json();
    }),
    fetch('static_data.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('static_data.json: HTTP ' + r.status);
      return r.json();
    })
  ]).then(function (res) {
    HISTORY = res[0];
    STATIC = res[1];
    fillYears();
    render();
    $('stamp').innerHTML = 'داده‌ها تا <bdi dir="ltr">' +
      (HISTORY.generated_at_display || '') + '</bdi>' +
      (HISTORY.assets.usd ? ' · دلار: <b>' + tomanFull(HISTORY.assets.usd.latest) + '</b> تومان' : '');
  }).catch(function (e) {
    resultsEl.innerHTML = '<div class="empty">بارگذاری داده ناموفق: ' + e.message + '</div>';
  });
})();
