document.addEventListener('DOMContentLoaded',()=>{
  const form=document.getElementById('reminder-form');
  const list=document.getElementById('reminder-list');
  const timeline=document.getElementById('timeline');
  const key='relief_reminders_v1';
  const historyKey='relief_history_v1';

  const reminders=JSON.parse(localStorage.getItem(key)||'[]');
  const history=JSON.parse(localStorage.getItem(historyKey)||'[{"date":"2026-01-02","event":"Symptom check completed","status":"Advised doctor consult"},{"date":"2026-01-04","event":"Appointment booked","status":"Dr. A. Sen - 10:30 AM"}]');

  function render(){
    list.innerHTML=reminders.length?reminders.map((r,i)=>`<li class="card" style="margin-bottom:8px"><strong>${r.medicine}</strong> - ${r.time} <button data-i="${i}" class="btn" style="margin-left:8px">Done</button></li>`).join(''):'<li class="muted">No reminders yet.</li>';
    timeline.innerHTML=history.map(h=>`<tr><td>${h.date}</td><td>${h.event}</td><td>${h.status}</td></tr>`).join('');
    localStorage.setItem(key,JSON.stringify(reminders));
    localStorage.setItem(historyKey,JSON.stringify(history));
  }

  form?.addEventListener('submit',(e)=>{
    e.preventDefault();
    const medicine=document.getElementById('medicine').value.trim();
    const time=document.getElementById('time').value;
    if(!medicine||!time)return;
    reminders.push({medicine,time});
    history.unshift({date:new Date().toISOString().slice(0,10),event:'Medication reminder created',status:`${medicine} at ${time}`});
    form.reset();
    render();
  });

  list?.addEventListener('click',(e)=>{
    const btn=e.target.closest('button[data-i]');
    if(!btn)return;
    const i=Number(btn.dataset.i);
    const item=reminders.splice(i,1)[0];
    if(item){history.unshift({date:new Date().toISOString().slice(0,10),event:'Reminder marked done',status:item.medicine});}
    render();
  });

  render();
});
