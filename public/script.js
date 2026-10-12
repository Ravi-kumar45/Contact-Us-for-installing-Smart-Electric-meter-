
(function () {
  "use strict";

  
  const LEAD_ENDPOINT = "/api/lead";   // backend ka route (server.js wala)
  const WHATSAPP_NUMBER = "917209050867";

  document.documentElement.classList.add("js");

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();


  const toggle = document.getElementById("menu-toggle");
  const nav = document.getElementById("site-nav");

  if (toggle && nav) {
    const setOpen = (open) => {
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "मेनू बंद करें" : "मेनू खोलें");
      nav.classList.toggle("open", open);
    };

    toggle.addEventListener("click", () => {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => setOpen(false));
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setOpen(false);
    });
  }

  
  const header = document.getElementById("header");
  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

 
  const revealEls = document.querySelectorAll(".reveal");

  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    revealEls.forEach((el) => io.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add("in"));
  }

  
  const form = document.getElementById("apply-form");
  if (!form) return;

  const statusEl = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const defaultBtnText = submitBtn.textContent;

  const field = (name) => form.elements.namedItem(name);
  const valueOf = (name) => (field(name) ? field(name).value.trim() : "");

  
  const normalizeMobile = (raw) => raw.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");

  const readRule = (name) => (name === "mobile" ? normalizeMobile(valueOf(name)) : valueOf(name));

  const rules = {
    name: (v) => (v.length >= 2 ? "" : "कृपया अपना पूरा नाम लिखें (कम से कम 2 अक्षर)।"),
    mobile: (v) => (/^[6-9]\d{9}$/.test(v) ? "" : "कृपया 10 अंकों का सही मोबाइल नंबर लिखें।"),
    address: (v) => (v.length >= 10 ? "" : "कृपया पूरा पता लिखें (गांव, पोस्ट, ब्लॉक, जिला)।"),
    serviceType: (v) => (v ? "" : "कृपया सेवा चुनें।")
  };

  const setError = (name, msg) => {
    const input = field(name);
    const errEl = form.querySelector(`[data-error-for="${name}"]`);
    if (input) input.setAttribute("aria-invalid", msg ? "true" : "false");
    if (errEl) errEl.textContent = msg;
  };

  const validate = () => {
    let firstInvalid = null;
    Object.keys(rules).forEach((name) => {
      const msg = rules[name](readRule(name));
      setError(name, msg);
      if (msg && !firstInvalid) firstInvalid = field(name);
    });
    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  };

  
  const clearIfValid = (e) => {
    const name = e.target.name;
    if (rules[name] && !rules[name](readRule(name))) setError(name, "");
  };
  form.addEventListener("input", clearIfValid);
  form.addEventListener("change", clearIfValid);

  const showStatus = (type, text, link) => {
    statusEl.className = "status" + (type ? " " + type : "");
    statusEl.textContent = text || "";

    if (link) {
      const a = document.createElement("a");
      a.className = "btn btn-whatsapp btn-sm";
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "💬 WhatsApp पर भेजें";
      statusEl.appendChild(a);
    }
  };

  const setLoading = (loading) => {
    submitBtn.disabled = loading;
    submitBtn.classList.toggle("is-loading", loading);
    submitBtn.textContent = loading ? "भेजा जा रहा है..." : defaultBtnText;
  };

  const whatsappLink = (d) => {
    const text =
      "नमस्ते सूरज जी, मुझे स्मार्ट मीटर के लिए आवेदन करना है।\n" +
      `नाम: ${d.name}\n` +
      `मोबाइल: ${d.mobile}\n` +
      `सेवा: ${d.serviceLabel}\n` +
      `पता: ${d.address}` +
      (d.message ? `\nसंदेश: ${d.message}` : "");
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`;
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showStatus("", "");

   
    if (valueOf("website")) {
      form.reset();
      showStatus("success", "धन्यवाद! आपका आवेदन मिल गया है।");
      return;
    }

    if (!validate()) {
      showStatus("error", "कृपया लाल रंग में दिखाई गई जानकारी ठीक करें।");
      return;
    }

    const serviceSelect = field("serviceType");
    const data = {
      name: valueOf("name"),
      mobile: normalizeMobile(valueOf("mobile")),
      address: valueOf("address"),
      serviceType: serviceSelect.value,
      serviceLabel: serviceSelect.options[serviceSelect.selectedIndex].text,
      message: valueOf("message"),
      submittedAt: new Date().toISOString()
    };

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(LEAD_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: controller.signal
      });

      if (!res.ok) throw new Error("HTTP " + res.status);

      form.reset();
      showStatus("success", "धन्यवाद! आपका आवेदन मिल गया है। हम जल्द ही आपसे संपर्क करेंगे।");
    } catch (err) {
      
      showStatus(
        "fallback",
        "अभी ऑनलाइन भेजने में दिक्कत है। नीचे दिए बटन से WhatsApp पर सीधे संदेश भेजें।",
        whatsappLink(data)
      );
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  });
})();