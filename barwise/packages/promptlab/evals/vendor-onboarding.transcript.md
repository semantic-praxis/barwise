Facilitator: Alright, I think we're mostly here. Raj said he'd be five minutes late, he's coming off another call. Should we start and catch him up, or wait?

Dana (Procurement Lead): Start. I have a hard stop at the hour and I'd rather not lose the front end.

Facilitator: Fine. So the goal today is to map how a supplier actually gets onboarded and used, end to end, in enough detail that we can write it down formally. I want the rules as they are, not as they should be. If something's broken, say it's broken -- I'd rather capture the mess accurately than capture a tidy version nobody follows.

Mei (Supplier Ops Analyst): That's going to be a long hour.

Facilitator: Probably. Dana, you own procurement. Start wherever it starts for you.

Dana: Where it starts. Okay. So, a buyer somewhere in the business decides they need something we don't have a supplier for. Could be a new software tool, could be a raw material, could be a consultant. They raise a request. That request lands with my team, and someone picks it up and starts what we call onboarding, which is honestly about six different things happening in parallel and not always in the same order.

Facilitator: Give me the six things.

Dana: I said six, I don't know that it's exactly six. We create the record. We get their tax documentation. We get banking details, which goes through a separate verification because of the fraud thing last year. We get them into the payment system, which is a different system, which is part of why this is painful. Compliance does their piece. And then somebody has to actually approve it, which depends on how much we're planning to spend.

Facilitator: Let's slow down. You said "we create the record." What is the record?

Dana: The vendor record. It's the thing in the supplier master.

Facilitator: And what's on it?

Dana: Legal name. Tax ID. Address, though we have three addresses really -- remit-to, ship-from, and the legal one, which are frequently different and frequently wrong. Status. Tier. The contact.

Facilitator: How do you tell one vendor from another?

Dana: By name, usually.

Facilitator: In the system, I mean. If I have two vendors, what makes them different records?

Dana: Oh. Vendor number. Every vendor has a vendor number, it's generated when the record is created.

Facilitator: Is that unique?

Dana: Yes.

Facilitator: Always? Every vendor has exactly one, and no two vendors share one?

Dana: Yes. That one I'm sure about. It's the thing we quote in every conversation with AP.

Mei: It's the primary key. It's been the primary key since before I got here.

Facilitator: Good. And could you identify a vendor by tax ID instead?

Dana: You'd think so, but no. We have vendors with the same tax ID -- different legal entities under one parent that file together, or we've onboarded the same company twice by accident and nobody's merged them.

Mei: The duplicates are a real problem. There's a cleanup project that's been on the roadmap for two years.

Facilitator: Noted, but out of scope for today. Tax ID isn't an identifier, vendor number is.

Dana: Correct.

[Raj joins]

Raj (Compliance Officer): Sorry. Handover call ran over.

Facilitator: No problem. We've covered: buyer raises a request, procurement creates a vendor record, vendor number is the identifier, tax ID isn't reliable because of duplicates.

Raj: The duplicates are also a compliance problem, for what it's worth. If we've got the same entity twice we can't see aggregate exposure.

Facilitator: Understood. Let's keep going forward. Dana, you mentioned status. What are the statuses?

Dana: Draft, active, suspended.

Facilitator: Only those three?

Dana: There used to be more. There was a "pending" and an "under review" and I think an "inactive," and they all got collapsed when we migrated.

Mei: Collapsed into three, yes. Draft, active, suspended. That's what the field allows now. Every vendor is in exactly one of them.

Facilitator: Can a vendor be in none of them? Blank?

Mei: No. It defaults to draft the moment the record is created.

Facilitator: Good. Dana, you said transacting depends on something. What has to be true before a buyer can raise a purchase order against a vendor?

Dana: Tax form on file. Once the W-9 is in, they're live and a buyer can raise a PO.

Raj: That's not right, Dana.

Dana: It's what we do.

Raj: It's what procurement does. It's not the rule and it hasn't been the rule since March.

Dana: Since March?

Raj: The tax form gets you a vendor record you can look at. It does not get you a vendor you can buy from. A vendor cannot be moved to active until a risk review has been completed and signed off. That was the entire point of the audit finding. That's why we spent Q1 on it.

Dana: I'll be honest with you, my team has been treating the W-9 as the gate.

Raj: I know they have. I've watched it happen. But the system does enforce it -- you cannot move a vendor to active without a completed review, the transition is blocked.

Dana: Then how are people transacting?

Mei: They're not, not without a review. What happens is procurement thinks the vendor is ready, tells the buyer it's ready, the buyer tries to raise the PO, it fails, and then it comes to me. That's most of my Tuesday.

Dana: That would explain a lot of angry emails.

Facilitator: So let me state it back and someone tell me if it's wrong. Every active vendor has a completed risk review.

Raj: Every active vendor has exactly one completed risk review. Not zero, and the one has to be signed off.

Facilitator: Exactly one. So a vendor with two completed reviews isn't valid?

Raj: A vendor can have several reviews over its life -- we re-review on a cycle, and every re-review is a new record, we don't edit the old one. But one of them is the current signed-off one.

Facilitator: I want to be careful here, because that's two different statements. "Exactly one completed review" and "several reviews of which one is current" are not the same thing.

Raj: ...You're right. Let me be precise. A vendor accumulates review records over time. At most one is the current one. Being active requires a current signed-off review.

Facilitator: Better. Mei, does the system model it that way?

Mei: The review is its own record. It has a review ID, because we need to know who signed it and when, and auditors ask. It's not a checkbox on the vendor.

Facilitator: Does a review belong to exactly one vendor?

Raj: One review, one vendor. There's no such thing as a review covering two suppliers, even for the parent-subsidiary cases, which people ask for constantly.

Facilitator: Good. Now, Dana, you said tier earlier. Tell me about tier.

Dana: Every vendor has a tier. Bronze, silver, gold.

Raj: That's not the tier I use.

Dana: What?

Raj: I use low, medium, high.

Facilitator: Hold on. Say more.

Dana: I'm talking about spend. Gold vendors are the ones we spend real money with, they get quarterly business reviews, better payment terms, a named relationship manager.

Raj: And I'm talking about risk. Low, medium, high, based on the review -- what data they touch, what geography they operate in, whether they're a sole source.

Facilitator: And you both call it "tier."

Raj: We both call it tier and it causes genuine chaos. Someone says "that's a high tier vendor" in a meeting and half the room hears "big spender" and the other half hears "dangerous," and those are very different conversations.

Dana: We've asked people to say spend tier and risk tier. Nobody does. It's been a losing battle for two years.

Facilitator: I want to come back to this because I don't think we've finished it, but let's park the naming and keep moving. Mei, in the system, are those the same field?

Mei: No. Two separate fields, different values, different owners. Procurement sets one, compliance sets the other.

Facilitator: Can a vendor be gold and high at the same time?

Mei: Most of our cloud providers are exactly that. Big spend, high risk. It's the most expensive quadrant to be in.

Facilitator: Okay, that settles it -- they're independent. Let's do contacts. Mei, how does a vendor contact work?

Mei: Each vendor has one primary contact. Name, email, phone number.

Facilitator: Exactly one?

Mei: Yes. Well -- hold on. That was true. That's not true anymore and I nearly gave you the wrong answer.

Facilitator: Take your time.

Mei: Since we went to regional sourcing last year, it's one primary contact per region. So a vendor operating in EMEA and APAC has two primary contacts, one for each region. I was about to tell you one per vendor and that's the old model.

Facilitator: Let me make sure I have it. It's the combination of the vendor and the region that determines the contact.

Mei: Right. A given vendor in a given region has exactly one primary contact. You cannot have two people both flagged primary for the same vendor in the same region -- the system rejects the second one.

Facilitator: And can a vendor have no contact in a region?

Mei: If they don't operate in that region, there's nothing there at all. Most of our vendors are one region only. It's the big ones that are multi-region.

Dana: The Meridian thing was what caused this, wasn't it.

Mei: Meridian is exactly what caused it.

Facilitator: Tell me, if it's relevant.

Dana: Meridian Components. We'd been buying from them in North America for years, one contact, a guy called Peter, everything fine. Then the APAC team started sourcing from their Singapore operation, and Singapore had a completely different account team who didn't know Peter existed. Purchase orders were going to Peter, Peter was forwarding them to Singapore, Singapore was treating them as informal, and we ended up with about four hundred thousand in orders that nobody on their side considered binding.

Raj: That one went to the audit committee.

Dana: It did. And the fix was that contact stopped being a vendor-level thing and became a vendor-and-region thing.

Facilitator: That's a good example, thank you. What identifies a region?

Mei: Region code. EMEA, APAC, NA, LATAM.

Facilitator: Four regions, fixed?

Mei: Four today. There's been talk of splitting EMEA but it hasn't happened.

Raj: Sorry -- I have to take this, it's the auditor. Two minutes.

[Raj steps out]

Facilitator: Let's use the time. Mei, you mentioned earlier that things come to you on Tuesdays. Is there anything you're tracking that isn't in the system?

Mei: ...Yes. Do you want the honest answer?

Facilitator: Always.

Mei: I keep a spreadsheet. Everyone knows about it, it's not a secret, but it's not official either. It's got about eighty vendors on it with notes -- who the real contact is when the system contact is stale, which ones have a handshake on payment terms that never made it into the record, which ones you should call rather than email.

Dana: I use that spreadsheet.

Mei: Half of procurement uses that spreadsheet.

Facilitator: Is there anything on it that's a rule rather than a note? Something the system should know?

Mei: There's a column called "preferred." It means if two vendors can supply the same thing, buy from this one. It's not in the system anywhere. It's just my column.

Facilitator: Who decides preferred?

Mei: Officially nobody. In practice, me and whoever's shouting loudest that week.

Dana: That's not fair, there's usually a reason.

Mei: There's usually a reason, but there's no process, and if I left tomorrow nobody would know why any of those flags are set.

Facilitator: I'm going to note that as a gap rather than a rule, because it doesn't sound like there's a defined rule to capture yet. If you tell me the criteria, I'll model it. If it's genuinely ad hoc, modeling it would be inventing something.

Mei: It's ad hoc. Don't model it.

Facilitator: Then it stays out. Let's do purchase orders while we wait for Raj. Dana?

Dana: A purchase order has a PO number. That's its identifier, same idea as vendor number. It's raised against exactly one vendor -- there's no such thing as a PO split across suppliers, you'd raise two POs. It has an amount and a raised date.

Facilitator: Can a vendor have many POs?

Dana: Many, or none. Plenty of vendors we onboarded and never used, which is its own problem.

Facilitator: And a PO always has a vendor? There's no orphan PO?

Dana: You can't create one without picking a vendor. The form won't let you.

Facilitator: Good. Anything else on the PO itself?

Dana: There's a lot -- line items, delivery dates, cost centre, approvals. But if we go there we'll be here all day and I don't think that's what you're after today.

Facilitator: It isn't. I'll take vendor, number, amount, date and we can extend later.

[Raj returns]

Raj: Sorry about that. Where are we?

Facilitator: Purchase orders. A PO is raised against exactly one vendor, and you can't raise one against a vendor who isn't active.

Raj: That's the control at creation. What we have never settled is what happens after.

Dana: Here we go.

Facilitator: Go on.

Raj: If we suspend a vendor -- their review lapses, or there's a breach, or they turn up on a sanctions list -- what happens to the purchase orders already in flight? My position is that everything halts immediately. That's what suspension means.

Dana: And that position is operationally impossible, which I have said in four separate meetings.

Raj: Say it a fifth time, then.

Dana: We have purchase orders where the goods are physically on a ship. You cannot halt a PO that's already shipped. What actually happens is the container arrives, the receiving team has no authority to accept it because the vendor is suspended, and the goods sit in a bonded warehouse accruing storage while three directors argue. That happened in November and it cost us more than the exposure would have.

Raj: I'm not disputing that it's painful. I'm saying that "keep fulfilling orders with a suspended supplier" is precisely the exposure the audit flagged, and I can't sign off on a model that makes it look sanctioned.

Dana: Then we need a middle state. Something like run-off -- existing POs complete, no new ones can be raised.

Mei: That's more or less what people do manually anyway. They suspend the vendor and then quietly let the open POs run.

Raj: Which is worse, because it's undocumented.

Dana: Agreed, actually. That's my argument for making it explicit.

Raj: Maybe. I'm not agreeing to a fourth status in this room, off the cuff, without Legal.

Facilitator: Is this something we can settle today?

Raj: No. This goes to the sourcing steering group. It's a policy call, not a modeling call, and Legal has to be in the room.

Dana: Park it. But please actually put it on an agenda this time.

Raj: I'll put it on the agenda.

Facilitator: Parking it explicitly: what happens to in-flight purchase orders when a vendor is suspended is undecided. Today's model captures three statuses and the creation-time control, and nothing about post-suspension fulfilment, because there is nothing agreed to capture.

Raj: That's a fair statement of it.

Facilitator: Let me come back to tier, because we left it half done. We established spend tier is bronze, silver, gold and risk tier is low, medium, high, and they're independent. Is either of them optional?

Dana: Every vendor gets a spend tier. Bronze by default if nobody's assessed them.

Raj: Risk tier comes from the review, so a vendor without a review has no risk tier. Draft vendors don't have one.

Facilitator: So risk tier depends on there being a review.

Raj: It's set by the review. A vendor with no review has no risk tier.

Facilitator: Good, that's clean. Let's do a read-back and then I'll let Dana go. Stop me where I'm wrong.

Dana: Two minutes, then I have to run.

Facilitator: A vendor is identified by a vendor number. It has a legal name, a tax ID which is not unique, and exactly one status: draft, active, or suspended. Every vendor has a risk review.

Raj: No.

Facilitator: Tell me.

Raj: Every _active_ vendor has a current signed-off review. A draft vendor has no review at all -- that's the normal case, that's what draft means. If you write down "every vendor has a review" you've written a rule we violate on every record we create.

Facilitator: You're right, and that's exactly the kind of thing I'd have shipped. Every active vendor has a current signed-off risk review. Draft vendors have none.

Raj: Yes.

Facilitator: Continuing. A risk review has a review ID and belongs to exactly one vendor. A vendor has a spend tier, always, one of bronze, silver, gold. A vendor has a risk tier only if it has been reviewed, one of low, medium, high. For each region a vendor operates in, it has exactly one primary contact. A region is identified by a region code. A purchase order is identified by a PO number, is raised against exactly one vendor, and has an amount and a raised date.

Mei: That's right.

Dana: That's right, and it's more precise than anything we've had written down.

Facilitator: And the open item is suspension and in-flight orders, going to the steering group.

Raj: Correct.

Facilitator: Then I have what I need. Dana, go.

Dana: Thank you. Send me the write-up.
