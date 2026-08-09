
/**
 * Module: EventDispatcher.js
 * Purpose: Contains logic for event dispatcher.
 */


import BaseEvent from "./BaseEvent";
import {dispatch} from "./DispatchCompat";
import EventList from "./EventList";
import FilterEvent from "./FilterEvent";
import GPUPickEvent from "./GPUPickEvent";
import ObjectEvent from "./ObjectEvent";
import PickEvent from "./PickEvent";
import RaycastEvent from "./RaycastEvent";
import RenderEvent from "./RenderEvent";
import ResizeEvent from "./ResizeEvent";
import ScriptChangedEvent from "./ScriptChangedEvent";
import TransformControlsEvent from "./TransformControlsEvent";
import ViewEvent from "./ViewEvent";
import global from "../global";

class EventDispatcher extends BaseEvent {
    constructor() {
        super();
        this.dispatch = dispatch.apply(dispatch, EventList);
        this.domEventListeners = [];

        this.events = [

            new RenderEvent(),
            new ResizeEvent(),
            new FilterEvent(),
            new ViewEvent(),
            new GPUPickEvent(),
            new ScriptChangedEvent(),

            new TransformControlsEvent(),
            new ObjectEvent(),
            new RaycastEvent(),
            new PickEvent(),
        ];
    }

    
    start() {
        this.addDomEventListener();
        this.events.forEach(n => {
            n.start();
        });
    }

    
    stop() {
        this.events.forEach(n => {
            n.stop();
        });
        this.removeDomEventListeners();
    }

    reset() {
        this.events.forEach(n => {
            n.reset();
        });
    }

    
    call(eventName, _this, ...others) {
        this.dispatch.call(eventName, _this, ...others);
    }


    on(eventName, callback) {
        this.dispatch.on(eventName, callback);
    }


    off(eventName) {
        this.dispatch.off(eventName);
    }


    addDomEventListener() {
        if (this.domEventListeners.length > 0) {
            return;
        }

        const container = global.app.container;
        this.addTrackedDomEventListener(container, "click", event => {
            this.dispatch.call("click", this, event);
        });
        this.addTrackedDomEventListener(container, "dblclick", event => {
            this.dispatch.call("dblclick", this, event);
        });
        this.addTrackedDomEventListener(document, "keydown", event => {
            this.dispatch.call("keydown", this, event);
        });
        this.addTrackedDomEventListener(document, "keyup", event => {
            this.dispatch.call("keyup", this, event);
        });
        this.addTrackedDomEventListener(container, "mousedown", event => {
            this.dispatch.call("mousedown", this, event);
        });
        this.addTrackedDomEventListener(container, "mousemove", event => {
            this.dispatch.call("mousemove", this, event);
        });
        this.addTrackedDomEventListener(container, "mouseup", event => {
            this.dispatch.call("mouseup", this, event);
        });
        this.addTrackedDomEventListener(container, "mousewheel", event => {
            this.dispatch.call("mousewheel", this, event);
        });
        this.addTrackedDomEventListener(
            window,
            "resize",
            event => {
                this.dispatch.call("resize", this, event);
            },
            false,
        );
        this.addTrackedDomEventListener(
            document,
            "dragover",
            event => {
                this.dispatch.call("dragover", this, event);
            },
            false,
        );
        this.addTrackedDomEventListener(
            document,
            "drop",
            event => {
                this.dispatch.call("drop", this, event);
            },
            false,
        );
    }

    addTrackedDomEventListener(target, type, listener, options) {
        target.addEventListener(type, listener, options);
        this.domEventListeners.push({target, type, listener, options});
    }

    removeDomEventListeners() {
        this.domEventListeners.forEach(({target, type, listener, options}) => {
            target.removeEventListener(type, listener, options);
        });
        this.domEventListeners = [];
    }
}

export default EventDispatcher;
