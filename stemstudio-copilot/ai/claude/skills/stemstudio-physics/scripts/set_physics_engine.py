#!/usr/bin/env python3
"""Generate JSONRPC 2.0 message to set the scene-level physics engine and optionally gravity in Studio 3D.

Engine choice is scene-level — all physics-enabled objects in the scene share the same engine.
Takes effect at next scene load; existing physics bodies keep running under whichever engine
was active when the scene loaded.

Valid engines: ammo (default) | rapier
"""
import sys, os; sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', '_lib'))
from studio import jsonrpc, build_params, add_id_arg
import argparse

parser = argparse.ArgumentParser(description="Generate JSONRPC message to set the scene-level physics engine and optional gravity")
parser.add_argument("--type", required=True, choices=["ammo", "rapier"],
                    help="Physics engine. Default in new scenes is 'ammo'.")
parser.add_argument("--gravity", type=float, default=None,
                    help="Scene gravity on the Y axis. Negative = down (Earth-like is -9.81). Optional — omit to leave gravity unchanged.")
add_id_arg(parser)
args = parser.parse_args()

params = build_params(type=args.type, gravity=args.gravity)
print(jsonrpc("set_physics_engine", params, args.id))
