(() => {
  "use strict";
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("YOUR_PROJECT_ID") &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  const $ = (id) => document.getElementById(id);
  const money = (value) => new Intl.NumberFormat("en-BD", { style: "currency", currency: "BDT", maximumFractionDigits: 2 }).format(Number(value || 0));
  const todayISO = () => new Date().toLocaleDateString("en-CA");
  const monthISO = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
  const monthDate = (month) => `${month}-01`;
  const monthLabel = (month) => month ? new Date(`${month}-01T12:00:00`).toLocaleDateString("en-BD",{month:"long",year:"numeric"}) : "";
  const escapeHTML = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let supabase = null, currentUser = null, authMode = "signin";
  let tenants = [], units = [], payments = [], funds = [], lastReceipt = null;
  let toastTimer = null;

  function toast(message, error = false) {
    const el = $("toast"); el.textContent = message; el.className = `toast show${error ? " error" : ""}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = "toast", 3600);
  }
  function showAuth() { $("auth-view").classList.remove("hidden"); $("app-view").classList.add("hidden"); }
  function showApp() { $("auth-view").classList.add("hidden"); $("app-view").classList.remove("hidden"); $("user-email").textContent = currentUser?.email || ""; }
  function errMessage(error) {
    if (!error) return "Something went wrong.";
    if (/duplicate key|unique constraint/i.test(error.message || "")) return "That unit name or receipt number already exists.";
    if (/row-level security|permission denied/i.test(error.message || "")) return "Permission denied. Check the Supabase SQL setup and sign-in status.";
    return error.message || "Something went wrong.";
  }
  async function runQuery(promise) {
    const { data, error } = await promise;
    if (error) throw error;
    return data;
  }
  function activeMonth() { return $("dashboard-month").value || monthISO(); }
  function unitTenant(unit) { return tenants.find(t => t.id === unit.tenant_id) || null; }
  function paidFor(unitId, month) {
    return payments.filter(p => p.unit_id === unitId && p.rent_month === monthDate(month)).reduce((sum,p)=>sum+Number(p.amount),0);
  }
  function dueFor(unit, month) {
    if (!unit.active || !unit.tenant_id || unit.lease_start > monthDate(month)) return 0;
    return Math.max(0, Number(unit.monthly_rent) - paidFor(unit.id, month));
  }
  function expectedFor(unit, month) {
    return unit.active && unit.tenant_id && unit.lease_start <= monthDate(month) ? Number(unit.monthly_rent) : 0;
  }
  function arrearsFor(unit, throughMonth) {
    if (!unit.active || !unit.tenant_id || unit.lease_start > monthDate(throughMonth)) return 0;
    let total = 0;
    const start = new Date(`${unit.lease_start}T12:00:00`);
    const end = new Date(`${throughMonth}-01T12:00:00`);
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1, 12);
    while (cursor <= end) {
      const month = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,"0")}`;
      total += Math.max(0, Number(unit.monthly_rent) - paidFor(unit.id, month));
      cursor.setMonth(cursor.getMonth()+1);
    }
    return total;
  }
  function statusFor(unit, month) {
    if (!unit.active || !unit.tenant_id) return ["Vacant","vacant"];
    const due = dueFor(unit, month), expected = expectedFor(unit, month);
    if (due <= 0) return ["Paid","paid"];
    if (paidFor(unit.id, month) > 0) return ["Partial","partial"];
    return ["Due","due"];
  }
  function badge(status) { return `<span class="status ${status[1]}">${status[0]}</span>`; }
  function emptyRow(cols, message="No records yet.") { return `<tr><td colspan="${cols}" class="empty">${escapeHTML(message)}</td></tr>`; }

  async function loadData() {
    try {
      const [t,u,p,f] = await Promise.all([
        runQuery(supabase.from("tenants").select("*").order("full_name")),
        runQuery(supabase.from("rental_units").select("*").order("unit_name")),
        runQuery(supabase.from("rent_payments").select("*").order("payment_date",{ascending:false}).limit(2000)),
        runQuery(supabase.from("tenant_funds").select("*").order("transaction_date",{ascending:false}).limit(3000))
      ]);
      tenants = t || []; units = u || []; payments = p || []; funds = f || [];
      renderAll();
    } catch (e) { toast(errMessage(e), true); }
  }
  function renderAll() {
    renderDashboard(); renderUnits(); renderTenants(); renderPayments(); renderReports(); renderFunds();
    $("current-month-label").textContent = monthLabel(activeMonth());
  }
  function renderDashboard() {
    const month = activeMonth(), occupied = units.filter(u=>u.active && u.tenant_id).length;
    const expected = units.reduce((s,u)=>s+expectedFor(u,month),0);
    const collected = payments.filter(p=>p.rent_month===monthDate(month)).reduce((s,p)=>s+Number(p.amount),0);
    const due = units.reduce((s,u)=>s+dueFor(u,month),0);
    $("stat-expected").textContent=money(expected); $("stat-collected").textContent=money(collected);
    $("stat-due").textContent=money(due); $("stat-occupied").textContent=`${occupied} / ${units.length}`;
    const list = units.filter(u=>u.active).map(u=>{
      const tenant=unitTenant(u), paid=paidFor(u.id,month), expectedRent=expectedFor(u,month), dueRent=dueFor(u,month);
      return `<tr><td><strong>${escapeHTML(u.unit_name)}</strong></td><td>${escapeHTML(tenant?.full_name || "—")}</td><td>${money(expectedRent)}</td><td>${money(paid)}</td><td>${money(dueRent)}</td><td>${badge(statusFor(u,month))}</td></tr>`;
    }).join("");
    $("dashboard-table").innerHTML=list || emptyRow(6,"Add a rental unit to get started.");
  }
  function renderUnits() {
    $("units-table").innerHTML=units.map(u=>{
      const tenant=unitTenant(u);
      return `<tr><td><strong>${escapeHTML(u.unit_name)}</strong></td><td>${escapeHTML(tenant?.full_name || "—")}</td><td>${money(u.monthly_rent)}</td><td>${escapeHTML(u.lease_start)}</td><td>${badge(u.active?(u.tenant_id?["Occupied","paid"]:["Vacant","vacant"]):["Inactive","vacant"])}</td><td><div class="row-actions"><button class="mini-btn" data-edit-unit="${u.id}">Edit</button><button class="mini-btn danger" data-delete-unit="${u.id}">Delete</button></div></td></tr>`;
    }).join("") || emptyRow(6,"No units added yet.");
  }
  function renderTenants() {
    $("tenants-table").innerHTML=tenants.map(t=>{
      const assigned=units.filter(u=>u.tenant_id===t.id).map(u=>u.unit_name).join(", ") || "—";
      return `<tr><td><strong>${escapeHTML(t.full_name)}</strong></td><td>${escapeHTML(t.phone||"—")}</td><td>${escapeHTML(t.email||"—")}</td><td>${escapeHTML(assigned)}</td><td><div class="row-actions"><button class="mini-btn" data-edit-tenant="${t.id}">Edit</button><button class="mini-btn danger" data-delete-tenant="${t.id}">Delete</button></div></td></tr>`;
    }).join("") || emptyRow(5,"No tenants added yet.");
  }
  function renderPayments() {
    const query=($("payment-search").value||"").trim().toLowerCase();
    const filtered=payments.filter(p=>{
      const unit=units.find(u=>u.id===p.unit_id), tenant=tenants.find(t=>t.id===p.tenant_id);
      return `${p.receipt_no} ${unit?.unit_name||""} ${tenant?.full_name||""}`.toLowerCase().includes(query);
    });
    $("payments-table").innerHTML=filtered.map(p=>{
      const unit=units.find(u=>u.id===p.unit_id), tenant=tenants.find(t=>t.id===p.tenant_id);
      return `<tr><td><strong>${escapeHTML(p.receipt_no)}</strong></td><td>${escapeHTML(p.payment_date)}</td><td>${escapeHTML(unit?.unit_name||"Deleted unit")} / ${escapeHTML(tenant?.full_name||"Tenant")}</td><td>${escapeHTML(p.rent_month.slice(0,7))}</td><td>${escapeHTML(p.method)}</td><td><strong>${money(p.amount)}</strong></td><td><button class="mini-btn" data-receipt="${p.id}">Receipt</button></td></tr>`;
    }).join("") || emptyRow(7,"No payments match this search.");
  }
  function fundBalance(tenantId, type) {
    return funds.filter(f=>f.tenant_id===tenantId && f.fund_type===type).reduce((sum,f)=>sum+(f.direction==="credit"?1:-1)*Number(f.amount),0);
  }
  function renderFunds() {
    const adv=funds.filter(f=>f.fund_type==="advance_rent").reduce((s,f)=>s+(f.direction==="credit"?1:-1)*Number(f.amount),0);
    const sec=funds.filter(f=>f.fund_type==="security_deposit").reduce((s,f)=>s+(f.direction==="credit"?1:-1)*Number(f.amount),0);
    $("fund-advance-total").textContent=money(adv); $("fund-security-total").textContent=money(sec);
    $("fund-balances-table").innerHTML=tenants.map(t=>{const unit=units.find(u=>u.tenant_id===t.id);return `<tr><td><strong>${escapeHTML(t.full_name)}</strong></td><td>${escapeHTML(unit?.unit_name||"—")}</td><td>${money(fundBalance(t.id,"advance_rent"))}</td><td>${money(fundBalance(t.id,"security_deposit"))}</td></tr>`;}).join("")||emptyRow(4,"No tenants available.");
    $("fund-history-table").innerHTML=funds.map(f=>{const t=tenants.find(x=>x.id===f.tenant_id);return `<tr><td>${escapeHTML(f.transaction_date)}</td><td>${escapeHTML(t?.full_name||"Tenant")}</td><td>${f.fund_type==="advance_rent"?"Advance rent":"Security deposit"}</td><td>${f.direction==="credit"?"Received":"Used / refunded"}</td><td><strong>${money(f.amount)}</strong></td><td>${escapeHTML(f.note||"—")}</td></tr>`;}).join("")||emptyRow(6,"No advance or deposit transactions yet.");
  }
  function openFundDialog() {
    if(!tenants.length){toast("Add a tenant first.",true);navigate("tenants");return;}
    $("fund-form").reset(); $("fund-tenant").innerHTML=tenants.map(t=>`<option value="${t.id}">${escapeHTML(t.full_name)}</option>`).join("");
    $("fund-unit").innerHTML='<option value="">Not specified</option>'+units.filter(u=>u.tenant_id).map(u=>`<option value="${u.id}">${escapeHTML(u.unit_name)}</option>`).join("");
    $("fund-date").value=todayISO(); $("fund-dialog").showModal();
  }
  async function saveFund(event) {
    event.preventDefault(); const tenantId=$("fund-tenant").value, type=$("fund-type").value, direction=$("fund-direction").value, amount=Number($("fund-amount").value);
    if(!(amount>0)){toast("Enter an amount greater than zero.",true);return;}
    if(direction==="debit" && amount>fundBalance(tenantId,type)){toast("This transaction is greater than the available balance.",true);return;}
    const payload={user_id:currentUser.id,tenant_id:tenantId,unit_id:$("fund-unit").value||null,fund_type:type,direction,amount,transaction_date:$("fund-date").value,note:$("fund-note").value.trim()};
    try{await runQuery(supabase.from("tenant_funds").insert(payload));$("fund-dialog").close();await loadData();toast("Advance / deposit transaction saved.");}catch(e){toast(errMessage(e),true);}
  }
  function renderReports() {
    const month=$("report-month").value||activeMonth();
    const expected=units.reduce((s,u)=>s+expectedFor(u,month),0);
    const collected=payments.filter(p=>p.rent_month===monthDate(month)).reduce((s,p)=>s+Number(p.amount),0);
    const due=units.reduce((s,u)=>s+dueFor(u,month),0);
    const arrears=units.reduce((s,u)=>s+arrearsFor(u,month),0);
    $("report-expected").textContent=money(expected); $("report-collected").textContent=money(collected);
    $("report-due").textContent=money(due); $("report-arrears").textContent=money(arrears);
    $("report-table").innerHTML=units.map(u=>{
      const tenant=unitTenant(u), exp=expectedFor(u,month), paid=paidFor(u.id,month), outstanding=dueFor(u,month), arr=arrearsFor(u,month);
      return `<tr><td><strong>${escapeHTML(u.unit_name)}</strong></td><td>${escapeHTML(tenant?.full_name||"—")}</td><td>${money(exp)}</td><td>${money(paid)}</td><td>${money(outstanding)}</td><td>${money(arr)}</td><td>${badge(statusFor(u,month))}</td></tr>`;
    }).join("") || emptyRow(7,"No units available.");
  }
  function navigate(page) {
    document.querySelectorAll(".page").forEach(el=>el.classList.add("hidden"));
    $(`page-${page}`).classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
    const names={dashboard:"Dashboard",units:"Rental units",tenants:"Tenants",payments:"Rent collection",funds:"Advance & deposit",reports:"Reports"};
    $("page-title").textContent=names[page]||"Dashboard";
  }
  function fillTenantSelect(select, selected="") {
    select.innerHTML='<option value="">Vacant / no tenant</option>'+tenants.map(t=>`<option value="${t.id}">${escapeHTML(t.full_name)}${t.phone?" — "+escapeHTML(t.phone):""}</option>`).join("");
    select.value=selected||"";
  }
  function openUnit(id=null) {
    $("unit-form").reset(); $("unit-id").value=""; fillTenantSelect($("unit-tenant"));
    $("unit-start").value=todayISO(); $("unit-active").checked=true; $("unit-dialog-title").textContent=id?"Edit rental unit":"Add rental unit";
    if(id){const u=units.find(x=>x.id===id);if(!u)return;$("unit-id").value=u.id;$("unit-name").value=u.unit_name;$("unit-rent").value=u.monthly_rent;$("unit-start").value=u.lease_start;$("unit-active").checked=u.active;fillTenantSelect($("unit-tenant"),u.tenant_id);}
    $("unit-dialog").showModal();
  }
  function openTenant(id=null) {
    $("tenant-form").reset(); $("tenant-id").value=""; $("tenant-dialog-title").textContent=id?"Edit tenant":"Add tenant";
    if(id){const t=tenants.find(x=>x.id===id);if(!t)return;$("tenant-id").value=t.id;$("tenant-name").value=t.full_name;$("tenant-phone").value=t.phone||"";$("tenant-email").value=t.email||"";$("tenant-notes").value=t.notes||"";}
    $("tenant-dialog").showModal();
  }
  function openPayment() {
    const occupied=units.filter(u=>u.active&&u.tenant_id);
    if(!occupied.length){toast("Add a tenant and assign them to a rental unit first.",true);navigate("units");return;}
    $("payment-form").reset(); $("payment-month").value=activeMonth(); $("payment-date").value=todayISO();
    $("payment-unit").innerHTML=occupied.map(u=>`<option value="${u.id}">${escapeHTML(u.unit_name)} — ${escapeHTML(unitTenant(u)?.full_name||"Tenant")}</option>`).join("");
    updatePaymentBalance(); $("payment-dialog").showModal();
  }
  function updatePaymentBalance() {
    const unit=units.find(u=>u.id===$("payment-unit").value), month=$("payment-month").value;
    const rent=unit?expectedFor(unit,month):0, already=unit?paidFor(unit.id,month):0, remaining=Math.max(0,rent-already);
    $("payment-rent").textContent=money(rent);$("payment-already").textContent=money(already);$("payment-remaining").textContent=money(remaining);
    $("payment-amount").max=remaining>0?remaining:undefined;
    if(remaining>0 && !$("payment-amount").value)$("payment-amount").value=remaining.toFixed(2);
  }
  async function saveUnit(event) {
    event.preventDefault();
    const id=$("unit-id").value;
    const payload={unit_name:$("unit-name").value.trim(),monthly_rent:Number($("unit-rent").value),tenant_id:$("unit-tenant").value||null,lease_start:$("unit-start").value,active:$("unit-active").checked,user_id:currentUser.id};
    try{
      if(id) await runQuery(supabase.from("rental_units").update(payload).eq("id",id));
      else await runQuery(supabase.from("rental_units").insert(payload));
      $("unit-dialog").close();await loadData();toast("Rental unit saved.");
    }catch(e){toast(errMessage(e),true);}
  }
  async function saveTenant(event) {
    event.preventDefault();
    const id=$("tenant-id").value;
    const payload={full_name:$("tenant-name").value.trim(),phone:$("tenant-phone").value.trim(),email:$("tenant-email").value.trim(),notes:$("tenant-notes").value.trim(),user_id:currentUser.id};
    try{
      if(id) await runQuery(supabase.from("tenants").update(payload).eq("id",id));
      else await runQuery(supabase.from("tenants").insert(payload));
      $("tenant-dialog").close();await loadData();toast("Tenant saved.");
    }catch(e){toast(errMessage(e),true);}
  }
  async function savePayment(event) {
    event.preventDefault();
    const unit=units.find(u=>u.id===$("payment-unit").value), month=$("payment-month").value, amount=Number($("payment-amount").value);
    if(!unit){toast("Select a rental unit.",true);return;}
    if(month<unit.lease_start.slice(0,7)){toast("Payment month cannot be before the lease start month.",true);return;}
    if(!(amount>0)){toast("Enter a payment amount greater than zero.",true);return;}
    const receiptNo=`HR-${Date.now().toString().slice(-8)}-${Math.random().toString(36).slice(2,5).toUpperCase()}`;
    const payload={unit_id:unit.id,tenant_id:unit.tenant_id,user_id:currentUser.id,rent_month:monthDate(month),amount,payment_date:$("payment-date").value,method:$("payment-method").value,note:$("payment-note").value.trim(),receipt_no:receiptNo};
    try{
      const saved=await runQuery(supabase.from("rent_payments").insert(payload).select().single());
      $("payment-dialog").close();await loadData();showReceipt(saved);toast("Payment saved and receipt created.");
    }catch(e){toast(errMessage(e),true);}
  }
  async function deleteRecord(table,id,label) {
    if(!confirm(`Delete this ${label}? This cannot be undone.`))return;
    try{await runQuery(supabase.from(table).delete().eq("id",id));await loadData();toast(`${label[0].toUpperCase()+label.slice(1)} deleted.`);}
    catch(e){toast(errMessage(e),true);}
  }
  function showReceipt(payment) {
    const unit=units.find(u=>u.id===payment.unit_id), tenant=tenants.find(t=>t.id===payment.tenant_id);
    lastReceipt=payment;
    $("receipt-content").innerHTML=`<div class="receipt-brand"><h2>House Rent Manager</h2><p>Rent payment receipt</p></div><div class="receipt-title">PAYMENT RECEIPT</div><div class="receipt-lines"><div><span>Receipt number</span><b>${escapeHTML(payment.receipt_no)}</b></div><div><span>Payment date</span><b>${escapeHTML(payment.payment_date)}</b></div><div><span>Tenant</span><b>${escapeHTML(tenant?.full_name||"Tenant")}</b></div><div><span>Phone</span><b>${escapeHTML(tenant?.phone||"—")}</b></div><div><span>Rental unit</span><b>${escapeHTML(unit?.unit_name||"—")}</b></div><div><span>Rent month</span><b>${escapeHTML(monthLabel(payment.rent_month.slice(0,7)))}</b></div><div><span>Payment method</span><b>${escapeHTML(payment.method)}</b></div><div><span>Reference / note</span><b>${escapeHTML(payment.note||"—")}</b></div></div><div class="receipt-total"><span>Amount received</span><span>${money(payment.amount)}</span></div><p class="receipt-foot">This receipt confirms the amount recorded above. Keep it for your records.</p>`;
    $("receipt-dialog").showModal();
  }
  function exportCSV() {
    const month=$("report-month").value||activeMonth();
    const rows=[["Month","Unit","Tenant","Expected rent (BDT)","Paid (BDT)","Due (BDT)","Arrears through month (BDT)","Status"]];
    units.forEach(u=>{const status=statusFor(u,month);rows.push([month,u.unit_name,unitTenant(u)?.full_name||"",expectedFor(u,month),paidFor(u.id,month),dueFor(u,month),arrearsFor(u,month),status[0]]);});
    const csv=rows.map(row=>row.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\r\n");
    const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8;"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=`rent-report-${month}.csv`;a.click();URL.revokeObjectURL(url);
  }
  async function authSubmit(event) {
    event.preventDefault();
    if(!configured){toast("First add your Supabase URL and public anon key in config.js.",true);return;}
    const email=$("auth-email").value.trim(),password=$("auth-password").value;
    $("auth-submit").disabled=true;
    try{
      if(authMode==="signup"){
        const {data,error}=await supabase.auth.signUp({email,password});if(error)throw error;
        if(data.session){currentUser=data.user;showApp();await loadData();}
        else toast("Account created. Check your email to confirm, then sign in.");
      }else{
        const {data,error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;
        currentUser=data.user;showApp();await loadData();
      }
    }catch(e){toast(errMessage(e),true);}finally{$("auth-submit").disabled=false;}
  }
  function setAuthMode(mode) {
    authMode=mode;document.querySelectorAll("[data-auth-tab]").forEach(b=>b.classList.toggle("active",b.dataset.authTab===mode));
    $("auth-submit").textContent=mode==="signup"?"Create account":"Sign in";
    $("auth-password").autocomplete=mode==="signup"?"new-password":"current-password";
  }
  async function signOut() {await supabase.auth.signOut();currentUser=null;tenants=[];units=[];payments=[];funds=[];showAuth();toast("Signed out.");}
  function bindEvents() {
    document.querySelectorAll("[data-auth-tab]").forEach(b=>b.addEventListener("click",()=>setAuthMode(b.dataset.authTab)));
    $("auth-form").addEventListener("submit",authSubmit);$("signout-btn").addEventListener("click",signOut);
    document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
    document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.go)));
    $("add-unit-btn").addEventListener("click",()=>openUnit());$("add-tenant-btn").addEventListener("click",()=>openTenant());
    $("add-payment-btn").addEventListener("click",openPayment);$("quick-payment").addEventListener("click",openPayment);
    $("add-fund-btn").addEventListener("click",openFundDialog);$("fund-form").addEventListener("submit",saveFund);
    $("unit-form").addEventListener("submit",saveUnit);$("tenant-form").addEventListener("submit",saveTenant);$("payment-form").addEventListener("submit",savePayment);
    document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
    $("dashboard-month").addEventListener("change",renderAll);$("report-month").addEventListener("change",renderReports);$("refresh-btn").addEventListener("click",loadData);
    $("payment-search").addEventListener("input",renderPayments);$("payment-unit").addEventListener("change",updatePaymentBalance);$("payment-month").addEventListener("change",updatePaymentBalance);
    $("print-receipt-btn").addEventListener("click",()=>window.print());$("print-report-btn").addEventListener("click",()=>window.print());$("export-csv-btn").addEventListener("click",exportCSV);
    $("units-table").addEventListener("click",e=>{const edit=e.target.closest("[data-edit-unit]"),del=e.target.closest("[data-delete-unit]");if(edit)openUnit(edit.dataset.editUnit);if(del)deleteRecord("rental_units",del.dataset.deleteUnit,"rental unit");});
    $("tenants-table").addEventListener("click",e=>{const edit=e.target.closest("[data-edit-tenant]"),del=e.target.closest("[data-delete-tenant]");if(edit)openTenant(edit.dataset.editTenant);if(del){const id=del.dataset.deleteTenant;if(units.some(u=>u.tenant_id===id)){toast("Reassign or remove this tenant from rental units before deleting.",true);return;}deleteRecord("tenants",id,"tenant");}});
    $("payments-table").addEventListener("click",e=>{const btn=e.target.closest("[data-receipt]");if(btn){const p=payments.find(x=>x.id===btn.dataset.receipt);if(p)showReceipt(p);}});
    $("dashboard-month").value=monthISO();$("report-month").value=monthISO();$("current-month-label").textContent=monthLabel(monthISO());
  }
  async function init() {
    bindEvents();
    if(!configured || !window.supabase?.createClient) {
      showAuth();toast("Setup needed: configure Supabase in config.js and run schema.sql.",true);return;
    }
    supabase=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
    const {data:{session}}=await supabase.auth.getSession();
    if(session){currentUser=session.user;showApp();await loadData();}else showAuth();
    supabase.auth.onAuthStateChange((_event,session)=>{if(session){currentUser=session.user;showApp();}else{currentUser=null;showAuth();}});
  }
  document.addEventListener("DOMContentLoaded",init);
})();
