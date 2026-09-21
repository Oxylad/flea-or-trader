import type { FleaRules } from "../../lib/market";
import type { SellSettings } from "../../lib/pricing";

interface SettingsProps {
  settings: SellSettings;
  flea: FleaRules | null;
  onChange: (settings: SellSettings) => void;
}

const toNumber = (value: string, min: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min;
};

export function Settings({ settings, flea, onChange }: SettingsProps) {
  const set = <K extends keyof SellSettings>(key: K, value: SellSettings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <details className="settings">
      <summary>Pricing settings</summary>
      <div className="settings__grid">
        <fieldset className="field">
          <legend>Flea market price</legend>
          <div className="segmented">
            {(
              [
                ["lastLowPrice", "Lowest offer"],
                ["avg24hPrice", "24 hour average"],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="flea-price"
                  checked={settings.fleaPriceBasis === value}
                  onChange={() => set("fleaPriceBasis", value)}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Undercut by</span>
          <span className="field__input">
            <input
              type="number"
              min={0}
              max={50}
              step={1}
              value={settings.undercutPercent}
              onChange={(event) => set("undercutPercent", toNumber(event.target.value, 0, 50))}
            />
            <span>%</span>
          </span>
        </label>

        <label className="field">
          <span>Use the flea market when it earns at least</span>
          <span className="field__input">
            <input
              type="number"
              min={0}
              step={1000}
              value={settings.minFleaGain}
              onChange={(event) => set("minFleaGain", toNumber(event.target.value, 0, 10_000_000))}
            />
            <span>₽ more per item</span>
          </span>
        </label>

        <label className="field field--check">
          <input
            type="checkbox"
            checked={settings.intelCenterLevel3}
            onChange={(event) => set("intelCenterLevel3", event.target.checked)}
          />
          <span>Intel Center level 3 (30% lower flea fees)</span>
        </label>

        <label className="field">
          <span>Hideout Management skill</span>
          <span className="field__input">
            <input
              type="number"
              min={0}
              max={51}
              disabled={!settings.intelCenterLevel3}
              value={settings.hideoutManagementLevel}
              onChange={(event) => set("hideoutManagementLevel", toNumber(event.target.value, 0, 51))}
            />
            <span>level</span>
          </span>
        </label>
      </div>
      {flea && (
        <p className="settings__note">
          Fee rates in this mode: {Math.round(flea.sellOfferFeeRate * 1000) / 10}% offer,{" "}
          {Math.round(flea.sellRequirementFeeRate * 1000) / 10}% requirement. The flea market opens at
          level {flea.minPlayerLevel}
          {flea.foundInRaidRequired ? " and only accepts found in raid items" : ""}.
        </p>
      )}
    </details>
  );
}
