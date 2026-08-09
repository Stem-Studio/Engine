import {getQueryString} from "./QueryStringUtils";
import {isInDiscordEnvironment} from "../userManagement/playerProfile/discordEnvironment";

export class DetectDevice {
    //cached values
    private static cachedIsMobile: boolean | undefined = undefined;
    private static cachedGetOs: string | undefined = undefined;
    private static cachedIsChrome: boolean | undefined = undefined;
    private static cachedGetBrowser: string | undefined = undefined;

    static isMobile(): boolean {
        if (DetectDevice.cachedIsMobile === undefined) {
            const mobilePattern = /Mobi|Android|iPhone|iPad|iPod|Windows Phone/i;
            let isMobileUserAgent = mobilePattern.test(navigator.userAgent);
            const isTouchDevice = "ontouchstart" in window || navigator.maxTouchPoints > 0;
            if (isInDiscordEnvironment()) {
                if (getQueryString("platform") === "mobile") {
                    isMobileUserAgent = true;
                }
            }
            DetectDevice.cachedIsMobile = isMobileUserAgent || isTouchDevice;
        }
        return DetectDevice.cachedIsMobile;
    }

    static isDesktop(): boolean {
        return !this.isMobile();
    }

    static isIOS(): boolean {
        return this.getOS() === "iOS";
    }

    static getDeviceType(): string {
        return this.isMobile() ? "Mobile" : "Desktop";
    }

    static getOS(): string {
        if (DetectDevice.cachedGetOs === undefined) {
            const userAgent = navigator.userAgent;

            if (/Windows NT/i.test(userAgent)) {
                DetectDevice.cachedGetOs = "Windows";
            } else if (/iPhone|iPad|iPod/i.test(userAgent)) {
                DetectDevice.cachedGetOs = "iOS";
            } else if (/Mac OS X/i.test(userAgent)) {
                DetectDevice.cachedGetOs = "macOS";
            } else if (/Android/i.test(userAgent)) {
                DetectDevice.cachedGetOs = "Android"; //must go before Linux
            } else if (/Linux/i.test(userAgent)) {
                DetectDevice.cachedGetOs = "Linux";
            } else {
                DetectDevice.cachedGetOs = "Unknown OS";
            }
        }
        return DetectDevice.cachedGetOs;
    }

    static isChrome(): boolean {
        if (DetectDevice.cachedIsChrome === undefined) {
            const userAgent = navigator.userAgent;
            // Check for Chrome specifically (not Chromium-based browsers like Edge)
            const isChrome = /Chrome/i.test(userAgent) && !/Edg/i.test(userAgent) && !/OPR/i.test(userAgent);
            DetectDevice.cachedIsChrome = isChrome && !!/Google Inc/.test(navigator.vendor);
        }
        return DetectDevice.cachedIsChrome;
    }

    static getBrowser(): string {
        if (DetectDevice.cachedGetBrowser === undefined) {
            const userAgent = navigator.userAgent;

            if (this.isChrome()) DetectDevice.cachedGetBrowser = "Chrome";
            if (/Firefox/i.test(userAgent)) DetectDevice.cachedGetBrowser = "Firefox";
            if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) DetectDevice.cachedGetBrowser = "Safari";
            if (/Edg/i.test(userAgent)) DetectDevice.cachedGetBrowser = "Edge";
            if (/OPR/i.test(userAgent)) DetectDevice.cachedGetBrowser = "Opera";

            DetectDevice.cachedGetBrowser = DetectDevice.cachedGetBrowser ?? "Unknown Browser";
        }
        return DetectDevice.cachedGetBrowser;
    }

    static getDeviceInfo(): string {
        return `${this.getDeviceType()} - ${this.getOS()} - ${this.getBrowser()}`;
    }
}
