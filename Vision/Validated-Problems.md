# Validated Problems

> Part of [[Vision]]

These 8 problems were confirmed through customer discovery interviews with robotics engineers at CMU RI, competition teams, exoskeleton projects, autonomous vehicles, and search-and-rescue robots.

## Problem 1: Integration is the #1 Time Sink
Engineers spend most of their time making systems work together (ROS + hardware + simulation + dependencies), not building functionality. "Making sure everything is compatible" was universal.

## Problem 2: No System-Level Understanding
No tool understands the robot as a full system. Engineers manually trace ROS topics, nodes, messages, wires. They hold the entire system model in their heads.

## Problem 3: Debugging is Manual and Fragmented
Checking ROS messages, running components one by one, googling errors, wire checking hardware. No structured assistance. "Lot of googling."

## Problem 4: Hardware Mistakes Are Catastrophic and Slow
PCB takes 2 days + shipping. Small mistake = full redesign. Engineers cross-reference datasheets AND research papers AND community posts to validate component values.

## Problem 5: Pre-Build Validation > Post-Build Debugging
"He wants to have less things to debug... figure things out before building." Current tools only help AFTER something breaks.

## Problem 6: Visualization is Underserved but Critical
Tools like rerun.io, viser, Foxglove are hard to use, require configuration, high learning curve. "Visualization is underrated and super helpful."

## Problem 7: Team Knowledge is Lost
People run into the same errors. Solutions exist but aren't discoverable. Documentation is inconsistent.

## Problem 8: Engineers Want Augmentation, Not Replacement
"He likes that it doesn't solve everything, he wants to use his brain." The product should augment thinking, not replace it.

## The Deeper Truth
Robotics engineers are constantly trying to answer: **"What is actually happening in my system right now?"** And they have no unified context, no system understanding, no reliable feedback loop.

#customer-discovery #problems #validation
