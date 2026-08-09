import {describe, expect, it} from "vitest";

import {parseParams, parseValue, tokenize} from "./parameterParser";
import {ScriptCommandParser} from "./ScriptCommandParser";

// === parameterParser tests ===

describe("parseValue", () => {
    it("parses booleans", () => {
        expect(parseValue("true")).toBe(true);
        expect(parseValue("false")).toBe(false);
    });

    it("parses numbers", () => {
        expect(parseValue("42")).toBe(42);
        expect(parseValue("3.14")).toBe(3.14);
        expect(parseValue("-1")).toBe(-1);
    });

    it("parses vector3 from comma-separated numbers when key is a vector key", () => {
        expect(parseValue("1,2,3", "position")).toEqual({x: 1, y: 2, z: 3});
        expect(parseValue("0.5,-1,3.14", "scale")).toEqual({x: 0.5, y: -1, z: 3.14});
    });

    it("does not parse vector3 for non-vector keys", () => {
        expect(parseValue("1,2,3", "color")).toBe("1,2,3");
        expect(parseValue("1,2,3")).toBe("1,2,3");
    });

    it("parses object literals", () => {
        expect(parseValue("{x:1,y:2,z:3}")).toEqual({x: 1, y: 2, z: 3});
    });

    it("returns strings as-is when no other type matches", () => {
        expect(parseValue("#ff0000")).toBe("#ff0000");
        expect(parseValue("hello")).toBe("hello");
    });
});

describe("tokenize", () => {
    it("splits on spaces", () => {
        expect(tokenize("add box name=Test")).toEqual(["add", "box", "name=Test"]);
    });

    it("keeps quoted strings together", () => {
        expect(tokenize('name="My Box"')).toEqual(['name="My Box"']);
    });

    it("keeps braced objects together", () => {
        expect(tokenize("config={shape:box,mass:0}")).toEqual(["config={shape:box,mass:0}"]);
    });

    it("handles mixed tokens", () => {
        expect(tokenize('add box position=1,2,3 name="Red Box" color=#ff0000')).toEqual([
            "add",
            "box",
            "position=1,2,3",
            'name="Red Box"',
            "color=#ff0000",
        ]);
    });
});

describe("parseParams", () => {
    it("parses key=value pairs", () => {
        const result = parseParams(["color=#ff0000", "name=Test"]);
        expect(result).toEqual({color: "#ff0000", name: "Test"});
    });

    it("parses --flag value pairs", () => {
        const result = parseParams(["--position", "1,2,3", "--color", "#ff0000"]);
        expect(result).toEqual({position: {x: 1, y: 2, z: 3}, color: "#ff0000"});
    });

    it("parses quoted values", () => {
        const result = parseParams(['name="My Object"']);
        expect(result).toEqual({name: "My Object"});
    });

    it("parses quoted --flag values", () => {
        const result = parseParams(["--target", '"My Object"', "--parent", '"Parent Group"']);
        expect(result).toEqual({target: "My Object", parent: "Parent Group"});
    });

    it("parses boolean flags", () => {
        const result = parseParams(["enabled=true", "visible=false"]);
        expect(result).toEqual({enabled: true, visible: false});
    });

    it("ignores bare tokens (no = or --)", () => {
        const result = parseParams(["baretoken", "key=val"]);
        expect(result).toEqual({key: "val"});
    });
});

// === ScriptCommandParser tests ===

describe("ScriptCommandParser.parse", () => {
    describe("built-in commands", () => {
        it("parses help", () => {
            const result = ScriptCommandParser.parse("help");
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("help");
        });

        it("parses help with topic", () => {
            const result = ScriptCommandParser.parse("help add");
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("help");
            expect(result.params.topic).toBe("add");
        });

        it("parses clear", () => {
            const result = ScriptCommandParser.parse("clear");
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("clear");
        });

        it("parses exit", () => {
            const result = ScriptCommandParser.parse("exit");
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("exit");
        });

        it("parses import with type", () => {
            const result = ScriptCommandParser.parse("import model");
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("import");
            expect(result.params.type).toBe("model");
            expect(result.params.message).toBeUndefined();
        });

        it("parses import with type and quoted name", () => {
            const result = ScriptCommandParser.parse('import behavior "Kart controller"');
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("import");
            expect(result.params.type).toBe("behavior");
            expect(result.params.name).toBe("Kart controller");
        });

        it("parses export scene with suggested name", () => {
            const result = ScriptCommandParser.parse('export scene name="my-scene-export"');
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("export");
            expect(result.params.target).toBe("scene");
            expect(result.params.name).toBe("my-scene-export");
        });

        it("parses dump scene with suggested name", () => {
            const result = ScriptCommandParser.parse('dump scene name="offline-bundle"');
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("dump");
            expect(result.params.target).toBe("scene");
            expect(result.params.name).toBe("offline-bundle");
        });

        it("parses check commands", () => {
            expect(ScriptCommandParser.parse("check").command).toBe("check");

            const exec = ScriptCommandParser.parse("check exec");
            expect(exec.isBuiltin).toBe(true);
            expect(exec.command).toBe("check");
            expect(exec.params.mode).toBe("exec");

            const buffer = ScriptCommandParser.parse("check buffer");
            expect(buffer.isBuiltin).toBe(true);
            expect(buffer.params.mode).toBe("buffer");
        });

        it("parses test as an admin-only script builtin", () => {
            const test = ScriptCommandParser.parse("test");
            expect(test.isBuiltin).toBe(true);
            expect(test.command).toBe("test");

            const testScript = ScriptCommandParser.parse("test script");
            expect(testScript.isBuiltin).toBe(true);
            expect(testScript.command).toBe("test");
            expect(testScript.params.mode).toBe("script");
        });
    });

    describe("shorthand add commands", () => {
        it("parses add box", () => {
            const result = ScriptCommandParser.parse("add box");
            expect(result.isBuiltin).toBe(false);
            expect(result.command).toBe("create_primitive");
            expect(result.params.type).toBe("box");
        });

        it("parses add sphere with params", () => {
            const result = ScriptCommandParser.parse("add sphere position=1,2,3 color=#ff0000");
            expect(result.command).toBe("create_primitive");
            expect(result.params.type).toBe("sphere");
            expect(result.params.position).toEqual({x: 1, y: 2, z: 3});
            expect(result.params.color).toBe("#ff0000");
        });

        it('parses add box with name="My Box"', () => {
            const result = ScriptCommandParser.parse('add box name="My Box"');
            expect(result.command).toBe("create_primitive");
            expect(result.params.type).toBe("box");
            expect(result.params.name).toBe("My Box");
        });

        it("parses add group as create_group", () => {
            const result = ScriptCommandParser.parse("add group name=MyGroup");
            expect(result.command).toBe("create_group");
            expect(result.params.name).toBe("MyGroup");
        });

        it("parses add vfx as add_vfx", () => {
            const result = ScriptCommandParser.parse("add vfx name=Fire");
            expect(result.command).toBe("add_vfx");
            expect(result.params.name).toBe("Fire");
        });

        it("parses add model as add_model_to_scene", () => {
            const result = ScriptCommandParser.parse("add model id=abc name=MyModel provider=local downloadUrl=url");
            expect(result.command).toBe("add_model_to_scene");
        });

        it("parses add prefab as add_prefab_to_scene", () => {
            const result = ScriptCommandParser.parse("add prefab id=abc");
            expect(result.command).toBe("add_prefab_to_scene");
        });
    });

    describe("navigation shorthand", () => {
        it("parses navmesh add", () => {
            const result = ScriptCommandParser.parse("navmesh add target=\"Default Scene\" autoGenerate=true");
            expect(result.command).toBe("add_navmesh");
            expect(result.params.target).toBe("Default Scene");
            expect(result.params.autoGenerate).toBe(true);
        });

        it("parses navmesh rebuild", () => {
            const result = ScriptCommandParser.parse("navmesh rebuild");
            expect(result.command).toBe("rebuild_navmesh");
        });

        it("parses navmesh connection add with bare source", () => {
            const result = ScriptCommandParser.parse("navmesh connection add RooftopStart target=RooftopEnd");
            expect(result.command).toBe("add_navmesh_connection");
            expect(result.params.source).toBe("RooftopStart");
            expect(result.params.target).toBe("RooftopEnd");
        });

        it("parses waypoint path add", () => {
            const result = ScriptCommandParser.parse("waypoint path add name=MarketLoop position=0,0,0 loop=true");
            expect(result.command).toBe("add_waypoint_path");
            expect(result.params.name).toBe("MarketLoop");
            expect(result.params.loop).toBe(true);
        });

        it("parses waypoint add", () => {
            const result = ScriptCommandParser.parse("waypoint add path=MarketLoop position=1,0,2 order=3");
            expect(result.command).toBe("add_waypoint");
            expect(result.params.path).toBe("MarketLoop");
            expect(result.params.position).toEqual({x: 1, y: 0, z: 2});
            expect(result.params.order).toBe(3);
        });
    });

    describe("object manipulation shorthand", () => {
        it("parses update with target and params", () => {
            const result = ScriptCommandParser.parse("update MyBox --position 1,3,1 --color #00ff00");
            expect(result.command).toBe("modify_object");
            expect(result.params.target).toBe("MyBox");
            expect(result.params.position).toEqual({x: 1, y: 3, z: 1});
            expect(result.params.color).toBe("#00ff00");
        });

        it("parses delete with target", () => {
            const result = ScriptCommandParser.parse("delete MyBox");
            expect(result.command).toBe("delete_object");
            expect(result.params.target).toBe("MyBox");
        });

        it("parses clone with target and position", () => {
            const result = ScriptCommandParser.parse("clone MyBox position=2,0,0");
            expect(result.command).toBe("clone_object");
            expect(result.params.target).toBe("MyBox");
            expect(result.params.position).toEqual({x: 2, y: 0, z: 0});
        });

        it("parses move with target", () => {
            const result = ScriptCommandParser.parse("move Child parent=Parent");
            expect(result.command).toBe("move_object");
            expect(result.params.target).toBe("Child");
            expect(result.params.parent).toBe("Parent");
        });

        it("parses move keepLocalSpace flag", () => {
            const result = ScriptCommandParser.parse("move Child parent=Parent keepLocalSpace=false");
            expect(result.command).toBe("move_object");
            expect(result.params.target).toBe("Child");
            expect(result.params.parent).toBe("Parent");
            expect(result.params.keepLocalSpace).toBe(false);
        });
    });

    describe("scene query shorthand", () => {
        it("parses list objects", () => {
            const result = ScriptCommandParser.parse("list objects");
            expect(result.command).toBe("get_scene_objects");
        });

        it("parses list objects with filter", () => {
            const result = ScriptCommandParser.parse("list objects filter=box");
            expect(result.command).toBe("get_scene_objects");
            expect(result.params.filter).toBe("box");
        });

        it("parses list lights to a read-only scene query", () => {
            // Lights are scene objects; `list lights` aliases to get_scene_objects
            // so the copilot can enumerate them during inspection.
            const result = ScriptCommandParser.parse("list lights");
            expect(result.command).toBe("get_scene_objects");
        });

        it("parses get with target", () => {
            const result = ScriptCommandParser.parse("get MyBox");
            expect(result.command).toBe("get_object");
            expect(result.params.target).toBe("MyBox");
        });

        it("parses get camera with target", () => {
            const result = ScriptCommandParser.parse('get camera "DefaultCamera"');
            expect(result.command).toBe("get_camera_settings");
            expect(result.params.target).toBe("DefaultCamera");
        });

        it("parses get outline as a scene setting", () => {
            const result = ScriptCommandParser.parse("get outline");
            expect(result.command).toBe("get_scene_setting");
            expect(result.params.category).toBe("outline");
        });

        it("parses type-specific object getters", () => {
            const result = ScriptCommandParser.parse("get box MyBox");
            expect(result.command).toBe("get_object_settings");
            expect(result.params.target).toBe("MyBox");
            expect(result.params.kind).toBe("box");
        });

        it("parses select", () => {
            const result = ScriptCommandParser.parse("select");
            expect(result.command).toBe("get_selected_object");
        });

        it("parses player", () => {
            const result = ScriptCommandParser.parse("player");
            expect(result.command).toBe("get_player");
        });
    });

    describe("physics shorthand", () => {
        it("parses physics enable", () => {
            const result = ScriptCommandParser.parse("physics enable Ground");
            expect(result.command).toBe("enable_physics");
            expect(result.params.target).toBe("Ground");
        });

        it("parses physics disable", () => {
            const result = ScriptCommandParser.parse("physics disable Ground");
            expect(result.command).toBe("disable_physics");
            expect(result.params.target).toBe("Ground");
        });

        it("parses physics set with config", () => {
            const result = ScriptCommandParser.parse('physics set Ground config={shape:"box",mass:0}');
            expect(result.command).toBe("set_physics");
            expect(result.params.target).toBe("Ground");
            expect(result.params.config).toEqual({shape: "box", mass: 0});
        });

        it("parses physics engine bare type", () => {
            const result = ScriptCommandParser.parse("physics engine rapier");
            expect(result.command).toBe("set_physics_engine");
            expect(result.params.type).toBe("rapier");
        });

        it("parses physics engine with gravity", () => {
            const result = ScriptCommandParser.parse("physics engine ammo gravity=-9.81");
            expect(result.command).toBe("set_physics_engine");
            expect(result.params.type).toBe("ammo");
            expect(result.params.gravity).toBe(-9.81);
        });

        it("parses scene compartments on", () => {
            const result = ScriptCommandParser.parse("scene compartments on");
            expect(result.command).toBe("set_scene_compartments");
            expect(result.params.enabled).toBe("on");
        });

        it("parses scene compartments off", () => {
            const result = ScriptCommandParser.parse("scene compartments off");
            expect(result.command).toBe("set_scene_compartments");
            expect(result.params.enabled).toBe("off");
        });
    });

    describe("behavior shorthand", () => {
        it("parses behavior attach", () => {
            const result = ScriptCommandParser.parse("behavior attach Player behaviorId=character");
            expect(result.command).toBe("attach_behavior");
            expect(result.params.target).toBe("Player");
            expect(result.params.behaviorId).toBe("character");
        });

        it("parses behavior list", () => {
            const result = ScriptCommandParser.parse("behavior list");
            expect(result.command).toBe("list_behaviors");
        });
    });

    describe("asset and VFX shorthand", () => {
        it("parses texture external", () => {
            const result = ScriptCommandParser.parse("texture external Ground assetId=rocky assetType=textures name=Rocky provider=polyhaven");
            expect(result.command).toBe("set_external_texture");
            expect(result.params.target).toBe("Ground");
            expect(result.params.assetId).toBe("rocky");
        });

        it("parses asset get", () => {
            const result = ScriptCommandParser.parse("asset get assetId=abc123");
            expect(result.command).toBe("get_library_asset");
            expect(result.params.assetId).toBe("abc123");
        });

        it("parses vfx behavior add", () => {
            const result = ScriptCommandParser.parse("vfx behavior add Fire behaviorType=ColorOverLife config={mode:gradient}");
            expect(result.command).toBe("add_vfx_behavior");
            expect(result.params.target).toBe("Fire");
            expect(result.params.behaviorType).toBe("ColorOverLife");
        });

        it("parses vfx behavior remove", () => {
            const result = ScriptCommandParser.parse("vfx behavior remove Fire behaviorIndex=0");
            expect(result.command).toBe("remove_vfx_behavior");
            expect(result.params.target).toBe("Fire");
            expect(result.params.behaviorIndex).toBe(0);
        });
    });

    describe("scene settings shorthand", () => {
        it("parses scene lighting", () => {
            const result = ScriptCommandParser.parse("scene lighting ambient={color:#ffffff,intensity:0.5}");
            expect(result.command).toBe("set_scene_lighting");
        });

        it("parses scene fog", () => {
            const result = ScriptCommandParser.parse("scene fog type=linear near=1 far=100");
            expect(result.command).toBe("set_scene_fog");
            expect(result.params.type).toBe("linear");
            expect(result.params.near).toBe(1);
            expect(result.params.far).toBe(100);
        });
    });

    describe("camera shorthand", () => {
        it("preserves decimal near plane values as numbers", () => {
            const result = ScriptCommandParser.parse(
                'camera "DefaultCamera" cameraType=NONE fov=60 near=0.01 far=500',
            );

            expect(result.command).toBe("set_camera_settings");
            expect(result.params.target).toBe("DefaultCamera");
            expect(result.params.cameraType).toBe("NONE");
            expect(result.params.fov).toBe(60);
            expect(result.params.near).toBe(0.01);
            expect(result.params.far).toBe(500);
        });
    });

    describe("require proxy", () => {
        it("parses require proxy with named params", () => {
            const result = ScriptCommandParser.parse('require proxy alias="/api/weather" destination="https://api.weather.com"');
            expect(result.isBuiltin).toBe(true);
            expect(result.command).toBe("require");
            expect(result.params.subcommand).toBe("proxy");
            expect(result.params.alias).toBe("/api/weather");
            expect(result.params.destination).toBe("https://api.weather.com");
        });

        it("parses require proxy with optional comment", () => {
            const result = ScriptCommandParser.parse('require proxy alias="/api/weather" destination="https://api.weather.com" comment="Weather API"');
            expect(result.params.comment).toBe("Weather API");
        });

        it("parses require with no tokens", () => {
            const result = ScriptCommandParser.parse("require");
            expect(result.isBuiltin).toBe(true);
            expect(result.params).toEqual({});
        });
    });

    describe("raw command pass-through", () => {
        it("passes through registry command names directly", () => {
            const result = ScriptCommandParser.parse("create_primitive type=box position={x:1,y:1,z:1}");
            expect(result.command).toBe("create_primitive");
            expect(result.params.type).toBe("box");
            expect(result.params.position).toEqual({x: 1, y: 1, z: 1});
        });

        it("passes through unknown commands", () => {
            const result = ScriptCommandParser.parse("some_future_command arg=val");
            expect(result.command).toBe("some_future_command");
            expect(result.params.arg).toBe("val");
        });
    });

    describe("edge cases", () => {
        it("handles empty input", () => {
            const result = ScriptCommandParser.parse("");
            expect(result.command).toBe("");
        });

        it("handles whitespace-only input", () => {
            const result = ScriptCommandParser.parse("   ");
            expect(result.command).toBe("");
        });

        it("is case-insensitive for commands", () => {
            const result = ScriptCommandParser.parse("ADD BOX");
            expect(result.command).toBe("create_primitive");
            expect(result.params.type).toBe("box");
        });

        it("parses quoted target names", () => {
            const result = ScriptCommandParser.parse('update "My Object" color=#ff0000');
            expect(result.params.target).toBe("My Object");
            expect(result.params.color).toBe("#ff0000");
        });

        it("parses quoted target names passed via --target", () => {
            const result = ScriptCommandParser.parse('update --target "My Object" --color #ff0000');
            expect(result.command).toBe("modify_object");
            expect(result.params.target).toBe("My Object");
            expect(result.params.color).toBe("#ff0000");
        });
    });
});

describe("ScriptCommandParser.getSuggestions", () => {
    it("returns matching built-in commands", () => {
        const suggestions = ScriptCommandParser.getSuggestions("he");
        expect(suggestions).toContain("help");
        expect(ScriptCommandParser.getSuggestions("du")).toContain("dump");
    });

    it("returns matching alias keys", () => {
        const suggestions = ScriptCommandParser.getSuggestions("physics");
        expect(suggestions).toContain("physics enable");
        expect(suggestions).toContain("physics disable");
        expect(suggestions).toContain("physics set");
    });

    it("returns primitive suggestions after add", () => {
        const suggestions = ScriptCommandParser.getSuggestions("add b");
        expect(suggestions).toContain("add box");
    });

    it("returns empty for empty input", () => {
        expect(ScriptCommandParser.getSuggestions("")).toEqual([]);
    });

    it("returns matching raw registry command names", () => {
        const suggestions = ScriptCommandParser.getSuggestions("set_ext");
        expect(suggestions).toContain("set_external_texture");
    });
});
