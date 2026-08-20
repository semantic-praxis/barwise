Facilitator: Kit's dialling in from the offsite so he may drop out. Let's start with the two of you and pull him in when he's stable.

Nadia (SRE Lead): He'll drop out at the worst possible moment, that's how it works.

Owen (Support Manager): Every time.

Facilitator: Then let's get the boring definitional stuff done while it's just us. What I want out of the hour is how an incident actually works here -- what one is, where it comes from, who owns it, how you classify it. Rules as they are, not as the runbook claims.

Owen: Those are different documents, you understand.

Facilitator: I'm counting on it. Nadia, start.

Nadia: Okay. Something breaks. We find out about it, one way or another. Somebody declares an incident, somebody runs it, we fix it, we write it up. That's the shape. Everything interesting is in the details of each of those.

Facilitator: "We find out about it, one way or another." What are the ways?

Nadia: Monitoring fires an alert, or a customer tells us.

Owen: Or a customer tells us and monitoring never fires, which is the embarrassing one.

Nadia: Or both, which is the common one -- the alert fires and support gets three tickets in the same two minutes.

Facilitator: Can an incident exist that came from neither?

Nadia: Someone noticing something by eye? It happens. An engineer's looking at a dashboard for another reason and spots something.

Facilitator: So it can come from nowhere in particular.

Nadia: ...No, actually, let me correct that. If an engineer spots something, they raise it, and raising it creates an alert record. It's a manual alert but it's still an alert. There's no path to an incident that doesn't have either an alert or a customer report behind it. The form requires you to link at least one.

Facilitator: At least one. So an incident has an alert, or a customer report, or both, and never neither.

Nadia: Never neither. The declare form won't let you.

Owen: That's right. I've tried, when someone's told me something in a corridor. You have to raise a ticket first and link it.

Facilitator: Good, that's a firm rule. How is an incident identified?

Nadia: Incident number. INC-, then a sequence.

Facilitator: Unique, never reused?

Nadia: Unique. And we never delete incidents, which becomes relevant later.

Facilitator: Flag it when we get there. And an alert -- identified how?

Nadia: Alert ID. Comes from the monitoring platform.

Owen: And a ticket has a ticket number. Different system, different format, always has.

Facilitator: Three different identifiers from three different systems. Fine, that's normal. Now, severity. Nadia?

Nadia: SEV1 through SEV4. It's about blast radius and technical impact. SEV1 is everything's down for everyone. SEV4 is degraded, cosmetic, one region, nobody's really suffering.

Owen: And priority is P1 through P4.

Facilitator: Which is different?

Owen: Which is completely different, and this is the single biggest source of miscommunication in the company. Priority is about customer urgency. Who's affected, what they've promised their own customers, whether we're breaching an SLA.

Nadia: And people say "sev" when they mean either. Somebody says "we've got a sev one" in a channel and I don't know whether to page the whole platform team or ring one account manager.

Facilitator: Are they correlated at all?

Owen: A P1 is always a SEV1.

Nadia: That is not true.

Owen: In practice --

Nadia: It's not true in practice either, and it's the assumption that gets us in trouble. Halberd Financial goes down -- one customer, one region, our biggest account, contractual penalties. That's a P1 all day. It's a SEV3. Small blast radius, big commercial consequence.

Owen: ...Yes. Alright. Yes, that's fair.

Nadia: And it goes the other way. We had a SEV1 at four in the morning on a Sunday where the affected surface was the marketing site. Everything down, nobody awake, no revenue impact. That was a P4.

Owen: I'd have argued P3.

Nadia: You'd have lost.

Facilitator: The point stands either way -- they're independent. Every incident has both?

Nadia: Every declared incident has a severity. That's mandatory, you can't declare without one.

Owen: Priority too. Support sets it, and it's on every incident.

Facilitator: Both mandatory, both single-valued, drawn from their own four values.

Owen: Yes.

Facilitator: Can either change during the incident?

Nadia: Constantly. Severity gets revised as we understand the blast radius. That's normal and expected.

Facilitator: Is the history of that kept?

Nadia: In the timeline, as events. The incident record carries the current severity.

Facilitator: I'll model the current one and note that changes exist in the timeline. Now, who runs an incident?

Nadia: The incident commander. One person, named, and it's a role for the duration, not a job title.

Facilitator: Every incident has a commander?

Nadia: Yes.

Facilitator: From the moment it exists?

Nadia: Yes -- no. No, that's wrong, and I nearly gave you a rule we break constantly. An incident starts in triage. In triage there's no commander, that's the point of triage: someone's looking at whether this is even real. A commander is assigned when it's declared. If it turns out to be nothing, it gets closed from triage having never had one.

Facilitator: So commander is optional in general, and mandatory once declared.

Nadia: That's the accurate version. Declared incidents have exactly one commander. Triage incidents have none.

Facilitator: What are the states?

Nadia: Triage, declared, mitigated, resolved, closed.

Facilitator: Five, and an incident is in exactly one?

Nadia: Exactly one at a time.

Owen: There's also "monitoring," which sits between mitigated and resolved.

Nadia: That's not a state, that's a thing people write in the channel.

Owen: People treat it as a state.

Nadia: People treat lots of things as states. It's not in the dropdown.

Facilitator: If it's not in the system I'm not modelling it. Five states.

Owen: Fine.

Facilitator: Now -- the other "owner." Nadia, you said commander is a role, not a job title. Is there a different sense of owner?

Nadia: There is, and it's the second collision. The service owner is the team that owns the broken thing. That's a standing assignment, nothing to do with the incident. The commander is whoever's running this particular incident, which is frequently someone from a completely different team.

Owen: And in a channel, "who owns this?" means either. It's genuinely ambiguous every single time.

Facilitator: Is a service owner a team or a person?

Nadia: A team. Services are owned by teams. People move.

Facilitator: And an incident affects a service?

Nadia: One or more. Usually one, sometimes several when it's an infrastructure thing.

Facilitator: How is a service identified?

Nadia: Service name. They're unique, we enforce it in the catalogue.

[Kit joins]

Kit (Engineering Manager): Am I audible? The wifi here is theoretical.

Facilitator: You're fine. We've covered origins, identifiers, severity versus priority, states, commander versus service owner.

Kit: Did anyone mention duplicates?

Facilitator: Not yet.

Kit: It's the thing I'd want captured, because it's the thing that breaks every report we run.

Facilitator: Go on.

Kit: One outage generates several incidents. Alert fires, someone declares. Two minutes later someone else who hasn't seen the channel declares another one for the same thing. Support gets tickets and declares a third. Now you've got three incidents for one event.

Nadia: And you can't just delete two of them, because people are already working in them and the timelines have real content.

Facilitator: So what do you do?

Kit: You link them. One is the primary and the others get marked as duplicates of it.

Facilitator: A duplicate relationship between two incidents.

Kit: Right. Incident B is a duplicate of incident A.

Facilitator: Can an incident be a duplicate of itself?

Kit: ...That's a strange question. No, obviously not.

Facilitator: I ask because if I write down "an incident is a duplicate of an incident" without saying so, that's permitted, and someone will eventually do it by accident.

Nadia: Someone did do it by accident. There was a script.

Kit: Was there?

Nadia: There was a bulk-linking script during the November mess and it linked one incident to itself and the dashboard divided by zero.

Facilitator: Then it's worth stating. An incident cannot be a duplicate of itself.

Kit: Agreed, and stated.

Facilitator: Can a chain form? B duplicates A, C duplicates B?

Kit: It shouldn't. The intent is that everything points at the primary directly. But nothing stops you making a chain and I've seen two-deep ones.

Facilitator: Is a chain wrong, or just untidy?

Kit: It's wrong. If C duplicates B and B duplicates A, then C should point at A. When we roll up incident counts we only follow one hop, so a chain undercounts.

Facilitator: So duplicates should point directly at a primary, and a primary is not itself a duplicate of anything.

Kit: That's the rule as intended. It's not enforced.

Facilitator: I'll capture it as the rule and note it isn't enforced today. Can an incident be a duplicate of more than one other?

Kit: No. One primary. It doesn't mean anything to be a duplicate of two different incidents.

Facilitator: Good. Now, Kit, while I have you -- the thing Nadia flagged earlier about never deleting incidents.

Nadia: This is the one I wanted to get to.

Owen: I know where this is going.

Nadia: Support raises tickets. Some of those tickets become incidents. A meaningful number of those turn out to be user error -- the customer had misconfigured something, or they were on an old client, or they were doing something we never supported.

Owen: Which we don't know at declaration time. That's the whole point.

Nadia: I'm not blaming anyone. But once we know, that incident is in the numbers. It's in mean time to resolve, it's in our incident count for the month, it's in the board deck. And it wasn't an incident, it was a support conversation with an incident record attached to it.

Owen: And my position is that it absolutely was an incident. The customer was down. From their side nothing worked. That we later established the cause was on their side doesn't make their outage imaginary.

Nadia: It makes it not a reliability event.

Owen: It makes it not _your_ reliability event.

Facilitator: What happens today?

Kit: Today it stays, and someone manually excludes it when they build the deck, if they remember.

Nadia: Which is not a process.

Owen: Which is also not deleting a customer's experience because it's inconvenient for a metric.

Nadia: I have never proposed deleting anything. I proposed a classification so we can count two things separately.

Owen: Then say classification, because what I keep hearing is "get it out of the numbers."

Nadia: That's fair. I'll say classification.

Facilitator: Is there a decision here today?

Kit: No, and it's above all three of us. That's a decision about what we report to the board, and Ravi owns that.

Nadia: Agreed.

Owen: Agreed, but please actually raise it. It's come up three quarters running.

Kit: I'll raise it with Ravi.

Facilitator: Parking it explicitly, then. Whether an incident later found to be caused by customer misconfiguration should be reclassified, excluded from reliability metrics, or left as-is, is undecided. The model today captures the five states and does not include any concept of a cause classification, because there isn't one to capture.

Nadia: That's accurate and slightly painful.

Facilitator: Let me read back. An incident is identified by an incident number. It has exactly one severity from SEV1 to SEV4 and exactly one priority from P1 to P4, and those are independent. It has at least one origin, being an alert or a customer ticket or both. It is in exactly one of five states: triage, declared, mitigated, resolved, closed. Every incident has exactly one commander.

Nadia: No.

Facilitator: Say it.

Nadia: Every _declared_ incident has a commander. Triage incidents have none, and that's the normal case for anything that turns out to be nothing. If you write "every incident has a commander" you've written a rule that's false for a good fraction of our records.

Facilitator: You're right, and I made the same mistake you nearly made an hour ago. Declared incidents have exactly one commander; triage incidents have none.

Nadia: Yes.

Facilitator: Continuing. An alert is identified by an alert ID, a ticket by a ticket number, a service by its name, and a service is owned by exactly one team. An incident affects one or more services. An incident may be a duplicate of at most one other incident, never of itself.

Kit: That's right.

Owen: That's right.

Facilitator: And the open item is the classification of customer-caused incidents, going to Ravi.

Kit: Going to Ravi.

Facilitator: Then I've got what I need, and Kit can go back to his offsite.

Kit: I've been back at the offsite for ten minutes, I just left this on.
