"use client";

import { useState } from "react";
import styles from "./CafeRoom.module.css";

const seats = Array.from({ length: 20 }, (_, index) => index + 1);
const avatars = ["🧑🏻‍🦱", "👩🏽‍🦰", "👨🏾‍🦱", "👩🏻‍🦳", "🧑🏿‍🦲", "👨🏻‍🦰", "👩🏾‍🦱", "🧑🏼‍🦰"];
type Occupant = { name: string; avatar: string; task?: string; minutes?: number };

export default function CafeRoom() {
  const [occupants, setOccupants] = useState<Record<number, Occupant>>(() => ({
    2: { name: "Mira", avatar: avatars[1], task: "Sketching new ideas", minutes: 24 },
    5: { name: "Theo", avatar: avatars[2], task: "Reading chapter 4", minutes: 18 },
    8: { name: "Jules", avatar: avatars[3], task: "Finishing the proposal", minutes: 42 },
    11: { name: "Sam", avatar: avatars[4], task: "Learning TypeScript", minutes: 31 },
    15: { name: "Ari", avatar: avatars[5], task: "Planning the week", minutes: 12 },
  }));
  const [selected, setSelected] = useState<number | null>(null);
  const [name, setName] = useState("Alex");
  const [task, setTask] = useState("");
  const [minutes, setMinutes] = useState("25");
  const occupied = Object.keys(occupants).length;

  function claimSeat(seat: number) {
    if (occupants[seat]) return;
    setSelected(seat);
  }

  function startSession() {
    if (!selected || !name.trim() || !task.trim()) return;
    setOccupants((current) => ({ ...current, [selected]: { name: name.trim(), avatar: avatars[0], task: task.trim(), minutes: Number(minutes) } }));
    setSelected(null);
    setTask("");
  }

  function leaveSeat(seat: number) {
    setOccupants((current) => {
      const next = { ...current };
      delete next[seat];
      return next;
    });
  }

  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <a className={styles.brand} href="#room" aria-label="Common Ground home"><span className={styles.brandMark}>cg</span><span>common ground</span></a>
        <div className={styles.topRight}><span className={styles.openLabel}><i /> OPEN TABLE</span><span className={styles.divider} /><span className={styles.capacity}><b>{occupied}</b> / 20 here</span><button className={styles.profile} aria-label="Profile">A</button></div>
      </header>

      <section className={styles.intro}>
        <div><p className={styles.eyebrow}>A LITTLE COMPANY GOES A LONG WAY</p><h1>Settle in.<br /><em>Get something done.</em></h1><p className={styles.subtitle}>A shared corner of the internet for doing your thing, together.</p></div>
        <div className={styles.roomNote}><span className={styles.noteIcon}>☼</span><span>Late afternoon<br /><b>Window seats are nice today</b></span></div>
      </section>

      <section className={styles.room} id="room" aria-label="Shared café seating">
        <div className={styles.window}><span>✳</span><div className={styles.windowLine} /><span>✳</span></div>
        <div className={styles.plant plantLeft}>♧</div><div className={styles.plant plantRight}>♧</div>
        <div className={styles.roomLabel}><span>THE COMMON ROOM</span><span className={styles.labelDot}>·</span><span>SEATS {String(occupied).padStart(2, "0")} / 20</span></div>
        <div className={styles.tables}>
          <div className={`${styles.table} ${styles.tableTop}`}><span>✿</span><span className={styles.tableCup}>◌</span></div>
          <div className={`${styles.table} ${styles.tableBottom}`}><span>✿</span><span className={styles.tableCup}>◌</span></div>
          {seats.map((seat) => {
            const occupant = occupants[seat];
            const row = ["topNorth", "topSouth", "bottomNorth", "bottomSouth"][Math.floor((seat - 1) / 5)];
            const column = ((seat - 1) % 5) + 1;
            return <div key={seat} className={`${styles.seat} ${styles[`${row}${column}`]} ${occupant ? styles.taken : styles.available}`}>
              {occupant ? <div className={styles.person} title={`${occupant.name}${occupant.task ? ` — ${occupant.task}` : ""}`}><div className={styles.taskCard}><span className={styles.taskName}>{occupant.task}</span><span className={styles.taskTime}>{occupant.minutes}:00</span></div><span className={styles.avatar}>{occupant.avatar}</span><span className={styles.personName}>{occupant.name}</span><button className={styles.leave} onClick={() => leaveSeat(seat)} aria-label={`Leave seat ${seat}`}>×</button></div> : <button className={styles.emptySeat} onClick={() => claimSeat(seat)} aria-label={`Claim available seat ${seat}`}><span>+</span></button>}
            </div>;
          })}
        </div>
        <div className={styles.counter}><span>☕</span><span>THE PICKUP<br /><b>Help yourself</b></span></div>
        <div className={styles.roomFooter}><span>✦ &nbsp;A GOOD DAY TO BEGIN</span><button aria-label="Toggle café ambience" title="Ambience coming soon">♫ <span>AMBIENCE</span></button></div>
      </section>

      <footer className={styles.footer}><span>COME AS YOU ARE. STAY A LITTLE.</span><span>MADE FOR THE IN-BETWEEN HOURS <b>✳</b></span></footer>

      {selected !== null && <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="dialogTitle"><button className={styles.close} onClick={() => setSelected(null)} aria-label="Close">×</button><p className={styles.eyebrow}>YOUR LITTLE CORNER</p><h2 id="dialogTitle">Make yourself at home.</h2><label>Your name<input value={name} maxLength={24} onChange={(event) => setName(event.target.value)} /></label><label>What are you working on?<input autoFocus value={task} maxLength={80} placeholder="A small thing, a big thing…" onChange={(event) => setTask(event.target.value)} /></label><div className={styles.dialogRow}><label>Focus time<select value={minutes} onChange={(event) => setMinutes(event.target.value)}><option value="25">25 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option></select></label><div className={styles.avatarChoice}><span>Your face</span><b>{avatars[0]}</b></div></div><button className={styles.startButton} disabled={!name.trim() || !task.trim()} onClick={startSession}>TAKE A SEAT <span>↗</span></button><p className={styles.smallNote}>Just a preview for now — your session stays on this device.</p></section></div>}
    </main>
  );
}
