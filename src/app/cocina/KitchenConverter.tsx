"use client";

import { useEffect, useRef, useState } from "react";
import { ingredients, US_CUP_ML } from "@/lib/kitchen/ingredients";
import { applyFraction, convert, describeInput, formatResult, needsIngredient, numberText, parseQuantity, unitLabel, units, type CupSize, type Unit } from "@/lib/kitchen/conversion";
import styles from "./kitchen.module.css";

function Announcement({ sentence }: { sentence: string }) {
  const region = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = region.current;
    if (!element) return;
    // Clear even when returning to a previously announced value. Only this
    // region is delayed; the visible result is derived during rendering.
    element.textContent = "";
    if (!sentence) return;
    const timeout = window.setTimeout(() => { element.textContent = sentence; }, 300);
    return () => window.clearTimeout(timeout);
  }, [sentence]);
  return <div ref={region} className={styles.srOnly} aria-live="polite" aria-atomic="true" />;
}

export default function KitchenConverter() {
  const [temperature, setTemperature] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [from, setFrom] = useState<Unit>("cup");
  const [to, setTo] = useState<Unit>("g");
  const [cup, setCup] = useState<CupSize>(250);
  const [ingredientId, setIngredientId] = useState("");
  const ingredient = ingredients.find(item => item.id === ingredientId);
  const cross = needsIngredient(from, to);
  const value = parseQuantity(quantity);
  const options = (Object.keys(units) as Unit[]).filter(unit => (units[unit].kind === "temperature") === temperature);
  let result = "", input = "", error = "";
  if (quantity.trim()) {
    if (value === null) error = "Ingresá un número, una fracción (1/2) o una cantidad mixta (1 1/2).";
    else if (value < 0 && !temperature) error = "La cantidad no puede ser negativa.";
    else if (!cross || ingredient) {
      try {
        const converted = convert(value, from, to, cup, ingredient);
        result = `${formatResult(converted, to)} ${unitLabel(to, cup, converted)}`;
        input = `${describeInput(value, from, cup)}${cross && ingredient ? ` de ${ingredient.name.toLocaleLowerCase("es-AR")}` : ""}`;
      } catch (cause) { error = cause instanceof Error ? cause.message : "Revisá la cantidad."; }
    }
  }
  const sentence = result ? `${input}, ${cross ? "aproximadamente " : "equivale a "}${result.replace("<", "menos de").replace(">", "más de")}.` : "";

  function changeMode(next: boolean) {
    if (next === temperature) return;
    setTemperature(next);
    setFrom(next ? "C" : "cup");
    setTo(next ? "F" : "g");
    setQuantity(next ? "180" : "1");
  }

  return <section className={styles.converter} aria-label="Calculadora de cocina">
    <div className={styles.modes} role="group" aria-label="Tipo de conversión">
      <button type="button" aria-pressed={!temperature} onClick={() => changeMode(false)}>Medidas e ingredientes</button>
      <button type="button" aria-pressed={temperature} onClick={() => changeMode(true)}>Temperatura</button>
    </div>
    <div className={styles.fields}>
      <label htmlFor="quantity">Cantidad</label>
      <input id="quantity" name="quantity" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={quantity}
        aria-invalid={Boolean(error)} aria-describedby={`quantity-hint${error ? " quantity-error" : ""}`}
        onChange={event => setQuantity(event.target.value)} />
      {!temperature && <div className={styles.fractions} role="group" aria-label="Agregar fracción a la parte entera">
        {([ ["1/4", "¼"], ["1/2", "½"], ["3/4", "¾"] ] as const).map(([fraction, label]) =>
          <button key={fraction} type="button" aria-label={`Usar fracción ${label}`} onClick={() => setQuantity(applyFraction(quantity, fraction))}>{label}</button>)}
        <span>Conservan la parte entera.</span>
      </div>}
      <p id="quantity-hint" className={styles.hint}>Usá coma o punto para decimales, sin separadores de miles: 1.000 se interpreta como 1.</p>
      {error && <p id="quantity-error" className={styles.error}>{error}</p>}
      <div className={styles.unitRow}>
        <div className={styles.field}><label htmlFor="from-unit">De</label><select id="from-unit" value={from} onChange={event => setFrom(event.target.value as Unit)}>{options.map(unit => <option key={unit} value={unit}>{units[unit].label}</option>)}</select></div>
        <button className={styles.swap} type="button" aria-label="Intercambiar unidades" onClick={() => { setFrom(to); setTo(from); }}>⇄</button>
        <div className={styles.field}><label htmlFor="to-unit">A</label><select id="to-unit" value={to} onChange={event => setTo(event.target.value as Unit)}>{options.map(unit => <option key={unit} value={unit}>{units[unit].label}</option>)}</select></div>
      </div>
      {!temperature && (from === "cup" || to === "cup") && <div className={styles.field}><label htmlFor="cup-size">Tamaño de taza</label>
        <select id="cup-size" value={cup} onChange={event => setCup(Number(event.target.value) as CupSize)}>
          <option value={250}>250 ml</option><option value={240}>240 ml</option><option value={US_CUP_ML}>Estadounidense · {numberText(US_CUP_ML)} ml</option>
        </select>
      </div>}
      {cross && <div className={styles.field}><label htmlFor="ingredient">Ingrediente</label>
        <select id="ingredient" value={ingredientId} onChange={event => setIngredientId(event.target.value)} aria-describedby="ingredient-hint">
          <option value="">Elegí un ingrediente</option>{ingredients.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>}
      {cross && <p id="ingredient-hint" className={styles.hint}>Una taza de harina y una de azúcar pesan distinto. Elegí qué estás midiendo.</p>}
    </div>
    <div className={styles.result} aria-label="Resultado">
      <p className={styles.resultLabel}>LA EQUIVALENCIA</p>
      {result ? <><p className={styles.interpreted}>{input}</p><p className={styles.answer}>{cross ? "≈ " : "= "}{result}</p>{cross && <p className={styles.hint}>Aproximadamente · {ingredient?.note}</p>}</>
        : <p className={styles.empty}>{error ? "Revisá la cantidad para ver el resultado." : !quantity.trim() ? "Ingresá una cantidad para empezar." : "Elegí un ingrediente para ver el resultado."}</p>}
    </div>
    <Announcement sentence={sentence} />
    {cross && ingredient && <details className={styles.details}>
      <summary>Cómo calculamos esta equivalencia</summary>
      <p>Usamos una densidad de referencia de {numberText(ingredient.density, 4)} g/ml. Cambiar la taza cambia el volumen, no la densidad.</p>
      <p>Medida original: {ingredient.originalMeasure}.</p>
      <p><a href={ingredient.source} target="_blank" rel="noreferrer">Fuente: {ingredient.sourceName} ↗</a></p>
    </details>}
    <p className={styles.rounding}>Redondeamos según la unidad para facilitar la lectura. Cada resultado parte del cálculo completo: g, kg y lb pueden mostrar distinta precisión. Para mayor precisión al cocinar, usá una balanza.</p>
  </section>;
}
