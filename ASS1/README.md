BTTP 
A visual monitoring tool-kit to visualize and monitor your batch data .
- Overview
Ph and Temperature are both two main variables that directly influence cell growth in fermentation processes .
   The goal of this project was to create graphs and data translations to be able to visualize the deviation
   of the multiple batch runs .
   Categorize optimal and not optimal results 
    Compare mode A and mode B on the same data but different degree of freedom 
- Features
     def __init__(self, filepath, ph_lims, temperature_lims): 
  This function goal was to load the dataset and stores the acceptable pH and temperature ranges.
	 
- def extract_batch(self, batch_id):
  This function goal was to returns a time-sorted DataFrame containing only one batch.
	
- def optimal_ph_mask(self, df_batch):
  This function goal was to determines whether each pH measurement falls within
        the acceptable operating range.

- def optimal_temperature_mask(self, df_batch):
  This function goal was to determine whether each temperature measurement falls
        within the acceptable operating range.

- def get_n_batches(self):
  This function goal was to determine the number of unique batches present
        in the dataset.

-def export_dashboard(self, batch_id, filepath):
  This function goal was to create and saves a dashboard figure for a single batch.

- Library used 
  Python for the main code 
  Pandas for tables and data reading
  Matplotlib for dashboard figures

- Code design

When you run `main.py`, 
it first sets up 2 modes with different limits.
Mode A uses pH 4.8 to 5.6 and temperature 34.0 to 36.0 °C. 
Mode B uses pH 5.1 to 5.5 and temperature 34.5 to 35.5 °C.

For each mode, it creates a `BioprocessMonitor` and 
loads the data from `datasets/dataset_fermentation.csv`.

Then it goes through every batch one by one. 
For each batch, `export_dashboard()` takes out the data for that batch with `extract_batch()`, checks which pH and temperature values are in range,
draws the 4 graphs, and saves the picture as `figures/Batch_XXX_Mode_Y.png`.

At the end, `export_summary()` makes the table. 
For each batch, it finds the % of pH values in range, the % of temperature values in range, and the amount of product at the end. Then it saves the table as `tables/Summary_Mode_Y.csv`.
The result is 10 dashboards (5 batches × 2 modes) and 2 summary tables. Output folders are created automatically if they do not exist.

-Dashboards
[Batch_003_Mode_B.png](figures/Batch_003_Mode_B.png)

This is Batch 3 with the Mode B limits (pH 5.1 to 5.5, temperature 34.5 to 35.5 °C). The batch lasts 36 hours.

- Top left: glucose goes down because the cells eat it. Biomass grows after about 15 h. Product goes up the whole time.
- Top right: temperature. Green means in range, red means out of range. The temperature is too high for a big part of the run.
- Bottom left: pH. It goes down over time and is out of range after about 14 h.
- Bottom right: dissolved oxygen. It goes down because the cells use more oxygen as they grow.

- Summary table
[Summary_Mode_A.csv](tables/Summary_Mode_A.csv)

Batches 1–4 kept pH in range more than 93 % of the time and reached final titers of 44.6–50.8 g/L.
Batch 5 kept temperature well controlled (99.08 %), but its pH was in range only 48.62 % of the time. 
Its final product concentration (24.7 g/L) is roughly half that of the other batches. This suggests pH control is the critical parameter for productivity in this process.