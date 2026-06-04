# Phoenix's Sim Racing Multiplayer Career Mode — User Manual

A complete how-to guide for Players and Game Masters using the SRMPC web application.

**Live App:** https://aosjay13.github.io/sim-racing-mpcm/app.html

---

## Table of Contents

1. [Overview](#overview)
2. [Account Types & Access Levels](#account-types--access-levels)
3. [Getting Started](#getting-started)
4. [Player Guide](#player-guide)
   - [Navigation Overview](#navigation-overview)
   - [Dashboard](#dashboard)
   - [Drivers](#drivers)
   - [Teams](#teams)
   - [Race Calendar](#race-calendar)
   - [Standings](#standings)
   - [Creating a Member Account](#creating-a-member-account)
   - [Choosing Your Career Role](#choosing-your-career-role)
   - [Driver Hub](#driver-hub)
   - [My Workspace](#my-workspace)
   - [Your Profile](#your-profile)
   - [Signing Up for Races](#signing-up-for-races)
5. [Game Master Guide](#game-master-guide)
   - [Accessing the Racing Manager](#accessing-the-racing-manager)
   - [Racing Manager Overview](#racing-manager-overview)
   - [Managing Drivers](#managing-drivers)
   - [Managing Teams](#managing-teams)
   - [Scheduling Races](#scheduling-races)
   - [Submitting Race Results](#submitting-race-results)
   - [Editing & Reopening Races](#editing--reopening-races)
   - [Rebuilding Standings](#rebuilding-standings)
   - [Moderation Queue](#moderation-queue)
   - [Account Access Requests](#account-access-requests)
   - [Managing Sponsors](#managing-sponsors)
   - [Payout Controls](#payout-controls)
   - [Games Catalog](#games-catalog)
   - [Cars Catalog](#cars-catalog)
   - [Admin Management](#admin-management)
   - [App Settings](#app-settings)
6. [Points Systems](#points-systems)
7. [Career Roles Reference](#career-roles-reference)
8. [Supported Simulations](#supported-simulations)

---

## Overview

SRMPC is a web-based league management platform for multiplayer sim racing. It supports driver profiles, team management, race scheduling, championship standings, and a career economy — across seven supported racing simulations.

The app has two distinct sides:
- **Players** — sign up, build a driver profile, enter races, and track their career.
- **Game Masters (GMs)** — run the league: schedule races, submit results, approve member requests, manage the economy, and control all data.

---

## Account Types & Access Levels

| Level | How to Access | What You Can Do |
|-------|--------------|-----------------|
| **Guest** | Visit the app, no login required | View drivers, teams, standings, calendar, and race details. No modifications. |
| **Member** | Sign up with email & password | Request driver/team profiles, sign up for races, access Driver Hub and career workspace. |
| **Game Master (Admin)** | Enter the GM passcode in the Racing Manager tab | Full league control: create/edit/delete all data, approve member requests, submit race results, manage finances. |

---

## Getting Started

1. Open the app at https://aosjay13.github.io/sim-racing-mpcm/app.html
2. As a guest, you can immediately browse the **Dashboard**, **Drivers**, **Teams**, **Calendar**, and **Standings** tabs.
3. To participate fully, create a Member account (see [Creating a Member Account](#creating-a-member-account)).
4. Game Masters unlock the **Racing Manager** tab using the GM passcode.

---

## Player Guide

### Navigation Overview

The top navigation bar contains:

| Tab | Who Can See It | Purpose |
|-----|----------------|---------|
| **Dashboard** | Everyone | League overview, quick stats, upcoming events |
| **Calendar** | Everyone | Monthly race schedule |
| **Drivers** | Everyone | View and search all drivers |
| **Teams** | Everyone | View all teams and their stats |
| **Standings** | Everyone | Driver and team championship leaderboards |
| **Driver Hub** | Members only | Your wallet, garage, race shop, race signups |
| **My Workspace** | Members only | Career role dashboard and KPIs |
| **Racing Manager** | Game Masters only | Full league administration panel |

**Header icons:**
- **⚙ Settings** — App preferences (points system, season year)
- **👤 Profile** — Your display name, email, team, and driver profile link
- **Sign In / Sign Out** — Authentication

---

### Dashboard

The Dashboard gives a live snapshot of the league:

- **Quick Stats** — Total active drivers, teams, races completed, and the date of the next scheduled race.
- **Recent Activity** — A feed of the latest league actions.
- **Upcoming Events** — The next scheduled races at a glance.
- **Admin Quick Panel** — Visible only to Game Masters; shortcut to the Racing Manager.

No action is required here — it is read-only for players.

---

### Drivers

The **Drivers** tab shows all approved driver profiles in the league.

- **Search Bar** — Filter drivers by name in real time.
- **Team Filter** — Narrow the list to a specific team.
- **Driver Cards** — Each card shows the driver number, name, team, country, and career stats (races, wins, podiums, points).

Guest and member players can view all information but cannot edit driver cards. Only Game Masters can add drivers directly from this tab.

---

### Teams

The **Teams** tab lists all approved teams.

- **Team Cards** — Show the team name, color, number of drivers, wins, podiums, and total championship points.
- **Create Team** — Members can submit a new team request (goes to moderation). Game Masters can create directly.

---

### Race Calendar

The **Calendar** tab presents the full race schedule.

- **Month Navigation** — Use the left/right arrows to move between months.
- **Calendar Grid** — Days with races are visually highlighted.
- **Race Timeline** — A list below the calendar shows all scheduled races with name, date, game, and track.
- **Race Details** — Click any race to open its detail modal (see [Signing Up for Races](#signing-up-for-races)).

---

### Standings

The **Standings** tab shows two leaderboards:

**Driver Standings** — Columns: Position, Driver, Team, Points, Races, Wins, Podiums. Sorted by championship points.

**Team Standings** — Columns: Position, Team, Points, Races, Wins, Podiums. Points aggregate all drivers on a team.

Standings update automatically after each race result is submitted by a Game Master.

---

### Creating a Member Account

1. Click **Sign In** in the top-right corner.
2. Select **Create Account**.
3. Enter your **email address** and a **password**.
4. Submit — you are now logged in as a Member.
5. The **Role Picker** modal will appear. Select your career role (see [Career Roles Reference](#career-roles-reference)).

> Your account is created immediately, but a Game Master may need to approve your driver/team profile requests before they appear in the league.

---

### Choosing Your Career Role

After signing up, choose one of eight career roles. You can switch your role at any time by clicking **Switch Role** in **My Workspace**.

| Role | Focus |
|------|-------|
| **Driver** | Enter races, earn points, build your career |
| **Team Owner** | Build and manage a racing team |
| **Crew Chief** | Lead team operations and strategy |
| **Mechanic** | Manage the vehicle fleet |
| **Agent** | Represent and manage drivers |
| **Sponsor** | Fund teams/drivers through sponsorship deals |
| **Series Owner** | Operate a racing series |
| **Track Owner** | Manage racing venues |

Each role unlocks a dedicated **My Workspace** dashboard with role-specific KPIs and tools.

---

### Driver Hub

The **Driver Hub** is your personal career center. It is only visible after logging in as a Member.

#### Budget / Wallet

- Displays your **current balance** (all members start with $200,000).
- Shows your last 8 **transactions**: sponsorship payouts, car purchases, race bonuses, and any penalties.
- Positive amounts are shown in green; negative amounts in red.

#### Garage

- Lists all cars you currently own.
- Shows each car's name and the simulation it belongs to.
- Click **Buy** next to any unowned car to purchase it from the Race Shop.

#### Race Shop

- Browse all available cars for purchase, organized by simulation.
- Use the **Game filter** dropdown to narrow the list.
- Each car shows its name, compatible game, and price.
- If you already own a car, its button shows **Owned**.
- Purchasing a car immediately deducts the price from your wallet and adds it to your Garage.

#### Available Races

- Lists all upcoming races you can enter.
- Shows race name, date, game, and track.
- Click **Sign Up** to enter a race (requires selecting a compatible car from your Garage).
- Click **Withdraw** if you need to drop out before results are submitted.

#### Season KPI Snapshot

- A live summary of your current season performance:
  - Races Entered, Races Completed, Wins, Podiums, DNFs
  - Average Finish Position
  - Total Championship Points

#### Recent Performance History

- A log of your last several race results.
- Shows finish position, points awarded, and date.
- DNF races are flagged.

---

### My Workspace

**My Workspace** provides a role-specific dashboard based on your selected career role. Each role displays relevant KPIs and management tools.

- **Switch Role** button in the top-right of the panel lets you change your active career role at any time without re-logging in.
- KPI cards update based on your activity in the league.

---

### Your Profile

Click the **👤 profile icon** in the header to open your Profile modal.

- **Display Name** — Your public name shown in the app.
- **Email** — Your login email (display only).
- **Primary Team** — Associate yourself with a team.
- **My Driver Profile** — Link your account to an approved driver profile in the league. This is required before you can sign up for races.
- **Account Type** — Shows whether you have a local or authenticated member account.

Click **Save Profile** to apply changes.

---

### Signing Up for Races

1. Open the **Calendar** tab and click on an upcoming race, or find it in **Driver Hub → Available Races**.
2. In the **Race Details** modal, review the race information (date, game, track, current participants).
3. Select a **car from your Garage** that is compatible with the race's simulation.
4. Click **Sign Me Up**.
5. Your name now appears in the participants list.

> You must have a linked and approved Driver Profile before signing up. If you do not have one, submit a driver profile request (via the **Drivers** tab → **Request Driver Profile**) and wait for Game Master approval.

---

## Game Master Guide

Game Masters have full control over the league. Everything in this section requires unlocking the **Racing Manager** tab with the GM passcode.

---

### Accessing the Racing Manager

1. Click the **Racing Manager** tab in the navigation.
2. An **Admin Passcode** prompt will appear.
3. Enter the passcode set by the league owner.
   - On first access ever, you set the initial passcode.
4. Once unlocked, the full Racing Manager panel is visible for the rest of the session.

---

### Racing Manager Overview

The Racing Manager is divided into several panels:

| Panel | Purpose |
|-------|---------|
| **League Control Tower** | Quick-add buttons for drivers, teams, and races |
| **Manager KPIs** | Live stats: approved drivers, teams, scheduled races, pending reviews |
| **Race Director Desk** | List of upcoming races with quick actions |
| **Operations Feed** | Activity log of all recent admin actions |
| **Race Schedule Control** | Full race list with filters and management options |
| **Moderation Queue** | Pending driver and team profile submissions from members |
| **Account Access Requests** | New member signup requests awaiting approval |
| **Admin Management** | Create and manage admin accounts |
| **Games Catalog** | Add/remove supported sim titles |
| **Cars Catalog** | Add/remove purchasable cars |
| **Payout Controls** | Apply manual financial bonuses or penalties |

---

### Managing Drivers

#### Adding a Driver (Admin Direct)

1. Click **+ Add Driver** in the League Control Tower, or in the **Drivers** tab.
2. Fill in the **Driver Name** (required), driver number, team, country, and bio.
3. To assign to an existing team, select it from the **Team** dropdown.
4. To create a new team at the same time, select **Create New Team** and enter the team name and color.
5. Click **Add Driver** — the driver is immediately approved and visible.

#### Editing a Driver

1. Find the driver in the **Drivers** tab.
2. Click the **Edit** button on their card.
3. Update any fields (name, number, team, country, bio).
4. Click **Save Changes**.

#### Deleting a Driver

1. Find the driver in the **Drivers** tab.
2. Click the **Delete** button on their card.
3. Confirm the deletion. This is permanent.

---

### Managing Teams

#### Creating a Team (Admin Direct)

1. Click **+ Add Team** in the League Control Tower, or the **Create Team** button in the **Teams** tab.
2. Enter the **Team Name** (required), team color (color picker), and description.
3. Click **Create Team** — the team is immediately approved.

#### Editing a Team

1. Find the team in the **Teams** tab.
2. Click the **Edit** button on the team card.
3. Update fields and click **Save Changes**.

#### Deleting a Team

1. Find the team in the **Teams** tab.
2. Click **Delete** on the team card and confirm.

---

### Scheduling Races

1. Click **+ Schedule Race** in the League Control Tower, or the **Add Race** button in the **Calendar** tab.
2. Fill in:
   - **Race Name** (required) — e.g., "Round 5 – Daytona"
   - **Date & Time** — Use the datetime picker
   - **Simulation / Game** — Select from the supported titles dropdown
   - **Track / Circuit** — Enter the track name
   - **Notes** — Optional description or special rules
3. Click **Schedule Race**.

The race appears in the Calendar and the Race Director Desk with status **Scheduled**.

---

### Submitting Race Results

After a race is run, submit the results to award points and update standings.

1. In the **Race Director Desk** or **Race Schedule Control**, find the race.
2. Click **Results** (or **View Details** and then **Submit Results**).
3. In the **Submit Results** form:
   - For each driver who signed up, enter their **Finish Position** (1, 2, 3, etc.).
   - Check the **DNF** box for any driver who did not finish.
   - Positions must be unique integers starting at 1.
4. Click **Submit Results**.

The system automatically:
- Calculates points based on the active **Points System** (F1, IndyCar, or NASCAR style).
- Awards 0 points to DNF drivers.
- Updates both Driver and Team Championship Standings.
- Processes any sponsor contract bonuses and penalties.
- Logs the submission to the Operations Feed with a timestamp and your UID.

---

### Editing & Reopening Races

#### Editing Race Details

1. Find the race in **Race Schedule Control**.
2. Click **Edit**.
3. Update race name, date, game, track, or notes.
4. Click **Edit Race** to save.

#### Editing Submitted Results

1. Open the race details for a completed race.
2. Click **Submit Results** again — the existing results are pre-filled.
3. Change any positions or DNF flags.
4. Submit — a new results version is saved and the audit trail is updated.

#### Reopening a Race

If you need to completely re-do a race's results:

1. Open the race details modal.
2. Click **Reopen Race**.
3. This resets the race status to **Scheduled**, clears all results, and removes the previously awarded points.
4. Players remain signed up. Submit new results when ready.

---

### Rebuilding Standings

If standings ever appear out of sync (e.g., after multiple result edits or a data import):

1. Open any completed race's detail modal.
2. Click **Rebuild Standings**.
3. The system recalculates all championship points from scratch across all completed races.

Use this sparingly — it is a full recalculation pass across all race data.

---

### Moderation Queue

When Members submit driver or team profile requests, they land in the **Moderation Queue**.

1. Open the **Moderation Queue** panel in the Racing Manager.
2. Use the **Filter** dropdown to view All, Drivers only, or Teams only.
3. For each pending item:
   - **Approve** — Makes the driver/team visible in the league. The member can now sign up for races (if a driver profile) or manage their team.
   - **Reject** — Declines the submission. You can add a **Moderation Note** explaining why. The member can resubmit after making corrections.

All approvals and rejections are logged in the Operations Feed.

---

### Account Access Requests

When new Members sign up, their accounts appear in **Account Access Requests**.

1. Open the panel in the Racing Manager.
2. Review the member's name, email, and request details.
3. Click **Approve** to grant member access or **Deny** to reject.

---

### Managing Sponsors

The **Sponsors** tab (visible to Game Masters) manages sponsorship contracts.

#### Creating a Sponsorship Contract

1. Go to the **Sponsors** tab.
2. Fill in:
   - **Company Name** — The sponsor's name
   - **Driver** or **Team** — Who the contract applies to
   - **Start Date** and **End Date**
   - **Payout Model:**
     - **Base Per Race** — Amount paid to the driver/team for each race entered
     - **Win Bonus** — Extra payout for finishing 1st
     - **Podium Bonus** — Extra payout for finishing 1st, 2nd, or 3rd
     - **DNF Penalty** — Amount deducted from wallet for a DNF
   - **Contract Terms** — Optional text describing the agreement
3. Click **Create Contract**.

#### Managing Existing Contracts

Contracts display with a **Status** badge:

| Status | Meaning |
|--------|---------|
| **Active** | Contract is running; payouts apply automatically after each race |
| **Pending** | Contract created but not yet started |
| **Paused** | Temporarily suspended; no payouts while paused |
| **Expired** | Contract end date has passed |
| **Terminated** | Contract was ended early |

Click the contract to edit or change its status.

---

### Payout Controls

**Payout Controls** let you apply manual financial adjustments to any player's wallet — bonuses, infractions, or corrections.

1. Open **Payout Controls** in the Racing Manager.
2. Fill in:
   - **Target User UID** — The Firebase UID of the member to adjust
   - **Driver ID** — (Optional) Associate the adjustment with a specific driver
   - **Amount** — Positive number = bonus (adds money), negative number = penalty (deducts money)
   - **Reason / Note** — Required description of why the adjustment is being made
3. Click **Apply Adjustment**.

Every adjustment is logged in the **Payout Audit List** with timestamp, actor UID, and reason. This list is read-only and cannot be modified.

---

### Games Catalog

The **Games Catalog** defines which racing simulations are available for race scheduling and car assignments.

#### Adding a Game

1. Open **Games Catalog** in the Racing Manager.
2. Enter:
   - **Game Key** — A short identifier, e.g., `iracing` or `wreckfest2` (no spaces)
   - **Display Name** — The name shown in the UI, e.g., `iRacing` or `Wreckfest 2`
3. Click **Add Game**.

#### Removing a Game

Click the **Delete** button next to any game in the list. This does not remove existing races or cars linked to that game.

---

### Cars Catalog

The **Cars Catalog** controls what cars members can purchase in the Race Shop.

#### Adding a Car

1. Open **Cars Catalog** in the Racing Manager.
2. Enter:
   - **Car Name** — Display name shown to players, e.g., `Chevrolet Camaro GT4`
   - **Game** — Select the simulation this car belongs to
   - **Price** — Cost in dollars (deducted from the player's wallet on purchase)
3. Click **Add Car**.

#### Removing a Car

Click **Delete** next to the car. Cars already in a player's Garage are not affected.

---

### Admin Management

The **Admin Management** panel lets you create and manage additional Game Master accounts.

#### Creating an Admin

1. Open **Admin Management** in the Racing Manager.
2. Enter:
   - **User UID** — The Firebase Authentication UID of the user (required)
   - **Email** — Their email address
   - **Display Name** — How they appear in the Operations Feed
   - **Status** — Active or Inactive
3. Click **Create Admin**.

#### Editing or Removing an Admin

- Click **Edit** to change any admin's details.
- Click **Delete** to remove admin access. This does not delete their Firebase account.

---

### App Settings

Click the **⚙ Settings** icon in the header to access app-wide configuration.

| Setting | Description |
|---------|-------------|
| **Points System** | Choose F1 Style, IndyCar Style, or NASCAR Style (applies to all new race results) |
| **Current Season** | The year/label used for the active championship season |
| **Max Drivers per Team** | The roster limit enforced when adding drivers to teams |

Click **Save Settings** to apply. Settings affect new result submissions; they do not retroactively recalculate existing races.

---

## Points Systems

Choose the points system in **Settings**. It applies globally to all race result submissions.

### F1 Style
| Position | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|----------|---|---|---|---|---|---|---|---|---|---|
| **Points** | 25 | 18 | 15 | 12 | 10 | 8 | 6 | 4 | 2 | 1 |

### IndyCar Style
Starts at 40 pts for the win, scaling down through the field.

### NASCAR Style
Starts at 43 pts for the win, scaling down through the field.

**DNF (Did Not Finish):** Always awards 0 points, regardless of the points system.

---

## Career Roles Reference

| Role | Description |
|------|-------------|
| **Driver** | Focuses on race participation, points, and personal career stats. The primary role for competing in races. |
| **Team Owner** | Builds and manages a racing team. KPIs focus on team points, driver roster, and team wins. |
| **Crew Chief** | Manages team technical operations. KPIs track crew performance and race preparation. |
| **Mechanic** | Maintains and manages the vehicle fleet. KPIs focus on car availability and condition. |
| **Agent** | Represents drivers and negotiates sponsorships. KPIs track represented drivers and deal value. |
| **Sponsor** | Funds drivers and teams via contracts. KPIs show investment, return metrics, and contract portfolio. |
| **Series Owner** | Runs a racing series within the league. KPIs show series entries, race counts, and participation. |
| **Track Owner** | Manages racing venues. KPIs track hosted events and facility usage. |

All roles share access to the **Driver Hub** features (wallet, garage, race shop, signups). The **My Workspace** KPIs and tools change per role.

---

## Supported Simulations

| Simulation | Key |
|-----------|-----|
| iRacing | `iracing` |
| NASCAR Racing 2003 Season | `nascar2003` |
| Wreckfest | `wreckfest` |
| Wreckfest 2 | `wreckfest2` |
| Automobilista 1 | `ams1` |
| Automobilista 2 | `ams2` |
| BeamNG.Drive | `beamng` |

Race scheduling, car assignments, and garage filtering all use these simulation categories to keep content organized per title.

---

*Manual version 1.0 — matches app version 0.3.16*
