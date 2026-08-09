
/**
 * Module: JsLoader.js
 * Purpose: Contains logic for js loader.
 */


import Ajax from "./Ajax";

class JsLoader {
    constructor() {
        this.assets = [];
    }

    load(url) {
        const data = {
            url,
            script: null,
        };
        this.assets.push(data);
        return Ajax.get({url, needAuthorization: false})
            .then(response => {
                data.script = response.data;
                return data;
            })
            .catch(() => {
                console.warn(`JsLoader: ${url} loaded failed.`);
                return null;
            });
    }

    eval() {
        const eval2 = eval;

        let script = "";

        this.assets.forEach(n => {
            if (n.script) {
                script += n.script + "\n";
            }
        });

        if (script) {
            eval2.call(window, script);
        }
    }
}

export default JsLoader;
