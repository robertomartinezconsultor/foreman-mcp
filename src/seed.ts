/**
 * Demo seed for a San Antonio remodeling company (First Class Remodeling
 * flavor). Everything is stamped RELATIVE to the moment the store is first
 * created, so the demo never rots: there is always work today, work tomorrow,
 * one unassigned job tomorrow, stale leads and low materials.
 */
import { addDays, hoursAgo, today } from "./dates.js";
import type { StoreData } from "./store.js";

export function buildSeed(now = new Date()): StoreData {
  const t = today(now);
  const tm = addDays(t, 1);
  const t2 = addDays(t, 2);

  return {
    version: 1,
    createdAt: now.toISOString(),
    crews: [
      {
        id: "crew-a",
        name: "Crew A",
        members: ["Juan Herrera", "Miguel Santos"],
        skills: ["tile", "kitchen", "finish carpentry"],
        phone: "+1 210 555 0141",
      },
      {
        id: "crew-b",
        name: "Crew B",
        members: ["Carlos Ruiz", "Diego Fuentes"],
        skills: ["plumbing", "roofing", "repairs"],
        phone: "+1 210 555 0142",
      },
      {
        id: "crew-c",
        name: "Crew C",
        members: ["Pedro Navarro", "Luis Ortega"],
        skills: ["paint", "drywall", "flooring"],
        phone: "+1 210 555 0143",
      },
    ],
    jobs: [
      {
        id: "job-101",
        customer: "Garcia Residence",
        address: "1420 W Bitters Rd, San Antonio, TX",
        service: "Kitchen remodel",
        stage: "Tile in progress (backsplash pending)",
        status: "active",
        crewId: "crew-a",
        scheduledDate: tm,
        scheduledTime: "08:00",
        estimatedHours: 6,
        materialsNeeded: [
          { item: "Porcelain tile 12x24 (box)", qty: 6 },
          { item: "Thinset mortar 50lb (bag)", qty: 4 },
        ],
        notes: [
          {
            at: hoursAgo(30, now),
            author: "Juan Herrera (Crew A)",
            text: "Countertops are in. Tile starts tomorrow morning; thinset is running low at the shop.",
          },
          {
            at: hoursAgo(26, now),
            author: "Office",
            text: "Homeowner asked about backsplash options; bring the sample board.",
          },
        ],
      },
      {
        id: "job-102",
        customer: "Chen Duplex",
        address: "88 Perrin Beitel Rd, San Antonio, TX",
        service: "Bathroom rough-in plumbing",
        stage: "Ready for rough-in",
        status: "active",
        crewId: null,
        scheduledDate: tm,
        scheduledTime: "09:30",
        estimatedHours: 5,
        materialsNeeded: [
          { item: "PEX pipe 3/4in 100ft (roll)", qty: 1 },
          { item: "PVC fittings assortment (box)", qty: 1 },
        ],
        notes: [
          {
            at: hoursAgo(8, now),
            author: "Office",
            text: "Permit approved. No crew assigned yet: this is the gap the morning dispatch must catch.",
          },
        ],
      },
      {
        id: "job-103",
        customer: "Nguyen Kitchen",
        address: "1211 McCullough Ave, San Antonio, TX",
        service: "Cabinet installation",
        stage: "Cabinets delivered, install pending",
        status: "active",
        crewId: "crew-a",
        scheduledDate: tm,
        scheduledTime: "13:00",
        estimatedHours: 4,
        materialsNeeded: [{ item: "Wood screws 2.5in (box)", qty: 1 }],
        notes: [
          {
            at: hoursAgo(20, now),
            author: "Office",
            text: "Same crew as Garcia in the morning: route Garcia 08:00, Nguyen 13:00.",
          },
        ],
      },
      {
        id: "job-104",
        customer: "Romero Exterior",
        address: "4303 Vance Jackson Rd, San Antonio, TX",
        service: "Exterior paint",
        stage: "Power wash done, prime next",
        status: "active",
        crewId: "crew-c",
        scheduledDate: t,
        scheduledTime: "08:00",
        estimatedHours: 7,
        materialsNeeded: [
          { item: "Exterior primer (gal)", qty: 3 },
          { item: "Exterior paint (gal)", qty: 6 },
        ],
        notes: [
          {
            at: hoursAgo(4, now),
            author: "Pedro Navarro (Crew C)",
            text: "Wash is done and dry. Starting primer after lunch if the wind stays down.",
          },
        ],
      },
      {
        id: "job-105",
        customer: "Smith Residence",
        address: "7722 Callaghan Rd, San Antonio, TX",
        service: "Roof leak repair",
        stage: "Inspection done, repair scheduled",
        status: "active",
        crewId: "crew-b",
        scheduledDate: t,
        scheduledTime: "10:00",
        estimatedHours: 3,
        materialsNeeded: [{ item: "Silicone sealant (tube)", qty: 4 }],
        notes: [
          {
            at: hoursAgo(50, now),
            author: "Carlos Ruiz (Crew B)",
            text: "Leak traced to a cracked vent boot. Sealant repair first; quote the boot replacement after.",
          },
        ],
      },
      {
        id: "job-106",
        customer: "Okafor Flooring",
        address: "15900 La Cantera Pkwy, San Antonio, TX",
        service: "LVP flooring install",
        stage: "Materials on site, install pending",
        status: "active",
        crewId: "crew-c",
        scheduledDate: tm,
        scheduledTime: "10:00",
        estimatedHours: 5,
        materialsNeeded: [
          { item: "LVP flooring planks (box)", qty: 14 },
          { item: "Underlayment (roll)", qty: 2 },
        ],
        notes: [
          {
            at: hoursAgo(12, now),
            author: "Office",
            text: "Customer moved furniture out already; floor can start on arrival.",
          },
        ],
      },
      {
        id: "job-107",
        customer: "Patel Bathroom",
        address: "9022 Wurzbach Rd, San Antonio, TX",
        service: "Bathroom remodel",
        stage: "Demo complete, tile starts in two days",
        status: "active",
        crewId: "crew-a",
        scheduledDate: t2,
        scheduledTime: "08:00",
        estimatedHours: 6,
        materialsNeeded: [
          { item: "Porcelain tile 12x24 (box)", qty: 8 },
          { item: "Grout 25lb (bag)", qty: 2 },
        ],
        notes: [
          {
            at: hoursAgo(28, now),
            author: "Juan Herrera (Crew A)",
            text: "Demo done, subfloor is solid. No surprises behind the walls.",
          },
        ],
      },
    ],
    leads: [
      {
        id: "lead-1",
        name: "Maria Torres",
        channel: "web form",
        phone: "+1 210 555 0117",
        topic: "Full kitchen quote",
        status: "new",
        receivedAt: hoursAgo(26, now),
        firstResponseAt: null,
        thread: [],
      },
      {
        id: "lead-2",
        name: "David Klein",
        channel: "phone",
        phone: "+1 210 555 0118",
        topic: "Roof leak repair",
        status: "new",
        receivedAt: hoursAgo(5, now),
        firstResponseAt: null,
        thread: [],
      },
      {
        id: "lead-3",
        name: "Sandra Ruiz",
        channel: "Facebook",
        phone: "+1 210 555 0119",
        topic: "Primary bathroom remodel",
        status: "new",
        receivedAt: hoursAgo(52, now),
        firstResponseAt: null,
        thread: [],
      },
      {
        id: "lead-4",
        name: "Tom Becker",
        channel: "web form",
        phone: "+1 210 555 0120",
        topic: "Flooring estimate, 900 sq ft",
        status: "replied",
        receivedAt: hoursAgo(30, now),
        firstResponseAt: hoursAgo(29, now),
        thread: [
          {
            at: hoursAgo(29, now),
            author: "Office",
            text: "Sent the ballpark range and asked for the room measurements; waiting on his reply.",
          },
        ],
      },
      {
        id: "lead-5",
        name: "Alicia Gomez",
        channel: "referral",
        phone: "+1 210 555 0121",
        topic: "Whole-home interior paint",
        status: "new",
        receivedAt: hoursAgo(9, now),
        firstResponseAt: null,
        thread: [],
      },
    ],
    inventory: [
      { id: "inv-1", item: "Porcelain tile 12x24 (box)", unit: "box", onHand: 9, lowAt: 10, location: "Shop rack 2" },
      { id: "inv-2", item: "Thinset mortar 50lb (bag)", unit: "bag", onHand: 3, lowAt: 6, location: "Shop rack 2" },
      { id: "inv-3", item: "Grout 25lb (bag)", unit: "bag", onHand: 5, lowAt: 3, location: "Shop rack 2" },
      { id: "inv-4", item: "PEX pipe 3/4in 100ft (roll)", unit: "roll", onHand: 2, lowAt: 1, location: "Shop rack 4" },
      { id: "inv-5", item: "PVC fittings assortment (box)", unit: "box", onHand: 4, lowAt: 2, location: "Shop rack 4" },
      { id: "inv-6", item: "LVP flooring planks (box)", unit: "box", onHand: 20, lowAt: 8, location: "Warehouse bay 1" },
      { id: "inv-7", item: "Underlayment (roll)", unit: "roll", onHand: 3, lowAt: 2, location: "Warehouse bay 1" },
      { id: "inv-8", item: "Exterior primer (gal)", unit: "gal", onHand: 4, lowAt: 3, location: "Paint locker" },
      { id: "inv-9", item: "Exterior paint (gal)", unit: "gal", onHand: 8, lowAt: 4, location: "Paint locker" },
      { id: "inv-10", item: "Silicone sealant (tube)", unit: "tube", onHand: 6, lowAt: 4, location: "Crew B truck" },
      { id: "inv-11", item: "Wood screws 2.5in (box)", unit: "box", onHand: 7, lowAt: 2, location: "Shop rack 1" },
    ],
    outbox: [],
    shoppingLists: [],
    audit: [
      {
        at: now.toISOString(),
        actor: "system",
        action: "store.seeded",
        detail: "Demo store created with the remodeling seed dataset.",
      },
    ],
  };
}
