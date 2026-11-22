import Icon from '../../components/common/Icon';

const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', note: 'Current interface language' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt', note: 'Translations not configured yet' }
];

/** Placeholder: the translation settings are not built yet. */
export default function MultilingualPanel() {
  return (
    <>
      <div className="ss-panel-head">
        <div>
          <h2>Multilingual</h2>
          <p>Configure the interface languages and translations between Vietnamese and English.</p>
        </div>
        <span className="ss-soon">Coming soon</span>
      </div>

      <div className="ss-placeholder" role="note">
        <Icon name="info" size={18} />
        <div>
          <strong>Language settings are not available yet.</strong>
          <p>This section is reserved for choosing the default language and managing Vietnamese ↔ English translations. The controls below are a preview and are disabled.</p>
        </div>
      </div>

      <div className="ss-card ss-language-list" aria-disabled="true">
        {LANGUAGES.map((language) => (
          <div key={language.code} className="ss-language-row">
            <span className="ss-language-code">{language.code.toUpperCase()}</span>
            <span className="ss-language-name"><strong>{language.native}</strong><small>{language.name} · {language.note}</small></span>
            <label className="ss-check is-disabled">
              <input type="radio" name="default-language" disabled defaultChecked={language.code === 'en'} />
              <span>Default</span>
            </label>
            <button type="button" className="ss-button" disabled>Edit translations</button>
          </div>
        ))}
      </div>
    </>
  );
}
