# =======================================================================
# CLASSES
# Define custom classes in this file.
# =======================================================================

import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

class BioprocessMonitor:
    def __init__(self, filepath, ph_lims, temperature_lims):
        """
        Utility class used to monitor bioprocesses by
        generating dashboards and summaries.

        Parameters
        ----------
        filepath : str
            Input CSV dataset path.
        ph_lims : tuple[float, float]
            Lower and upper acceptable pH limits.
        temperature_lims : tuple[float, float]
            Lower and upper acceptable temperature limits.
        """
        self.filepath = filepath
        self.ph_lims = ph_lims
        self.temperature_lims = temperature_lims
        self.df = pd.read_csv(filepath)
        print(self.df.columns)



    def extract_batch(self, batch_id):
        """
        Extracts data corresponding to a single batch.

        Parameters
        ----------
        batch_id : int
            Batch identifier.

        Returns
        -------
        pandas.DataFrame
            DataFrame containing only rows associated with
            the requested batch.
        """
        mask = self.df.loc[:, 'batch_id'] == batch_id
        return self.df.loc[mask, :]


    def optimal_ph_mask(self, df_batch):
        """
        Determines whether each pH measurement falls within
        the acceptable operating range.

        Parameters
        ----------
        df_batch : pandas.DataFrame
            Batch-specific DataFrame.

        Returns
        -------
        array-like of bool
            A mask whereby True indicates that the measurement
            is within the acceptable operating range.
        """
        ph = df_batch.loc[:, 'pH']
        mask = (ph >= self.ph_lims[0]) & (ph <= self.ph_lims[1])
        return mask.to_numpy()




    def optimal_temperature_mask(self, df_batch):
        """
        Determines whether each temperature measurement falls
        within the acceptable operating range.

        Parameters
        ----------
        df_batch : pandas.DataFrame
            Batch-specific DataFrame.

        Returns
        -------
        array-like of bool
            A mask whereby True indicates that the measurement
            is within the acceptable operating range.
        """
        temperature = df_batch.loc[:, 'temperature_C']
        mask = (temperature >= self.temperature_lims[0]) & (temperature <= self.temperature_lims[1])
        return mask.to_numpy()


    def get_n_batches(self):
        """
        Determines the number of unique batches present
        in the dataset.

        Returns
        -------
        int
            Total number of distinct batch identifiers.
        """
        return len(np.unique(self.df.loc[:, 'batch_id']))


    def export_dashboard(self, batch_id, filepath):
        """
        Creates and saves a dashboard figure for a single batch.

        Parameters
        ----------
        batch_id : int
            Batch identifier.
        filepath : str
            Output PNG image path.

        Dashboard Requirements
        ----------------------
        Create a 2 × 2 figure containing:

        Top-Left
            Glucose, biomass, and product concentrations versus time.
            - A different color and marker should be used for each substance.

        Top-Right
            Temperature versus time.
            - Measurements within the acceptable temperature range
              should be displayed as green circles.
            - Measurements outside the acceptable temperature range
              should be displayed as red X markers.

        Bottom-Left
            pH versus time.
            - Measurements within the acceptable pH range
              should be displayed as green circles.
            - Measurements outside the acceptable pH range
              should be displayed as red X markers.

        Bottom-Right
            Dissolved oxygen versus time.

        Additional Requirements
        -----------------------
        - Use scatter plots.
        - Add x-axis and y-axis labels.
        - Add legends where appropriate.
        - Apply consistent formatting across all subplots unless
          indicated otherwise.
        - Apply a tick spacing of 6 h on the x-axis for all subplots.
        - Save the figure to the provided filepath.
        - Close the figure after saving.
        """
        df_batch = self.extract_batch(batch_id)

        time= df_batch.loc[:, 'time_h'].to_numpy()
        glucose = df_batch.loc[:, 'C_glucose_g_L^-1'].to_numpy()
        biomass = df_batch.loc[:, 'C_biomass_g_L^-1'].to_numpy()
        product= df_batch.loc[:, 'C_product_g_L^-1'].to_numpy()
        temperature= df_batch.loc[:, 'temperature_C'].to_numpy()
        ph = df_batch.loc[:, 'pH'].to_numpy()
        dissolved_oxygen=df_batch.loc[:, 'DO_percent'].to_numpy()

        mask_temperature = self.optimal_temperature_mask(df_batch)
        mask_ph = self.optimal_ph_mask(df_batch)

        fig, axes = plt.subplots(2, 2, figsize=(12, 8), )

        # Concentrations
        axes[0,0].scatter(time, glucose , color='blue', marker='o' , alpha=0.7, label="glucose")
        axes[0, 0].scatter(time, biomass , color='orange', marker='^', alpha=0.7, label="biomass")
        axes[0, 0].scatter(time, product , color='green', marker='s', alpha=0.7, label="product")
        axes[0, 0].set_ylabel('Concentration [g/L]')

        # temperature
        axes[0, 1].scatter(time[mask_temperature], temperature[mask_temperature], color='green', marker='o', alpha=0.7, label="optimal")
        axes[0, 1].scatter(time[~mask_temperature], temperature[~mask_temperature], color='red', marker='X', alpha=0.7, label="sub_optimal")
        axes[0, 1].set_ylabel('Temperature C')

        # pH
        axes[1, 0].scatter(time[mask_ph], ph[mask_ph], color='green', marker='o', alpha=0.7,
                           label="optimal")
        axes[1, 0].scatter(time[~mask_ph], ph[~mask_ph], color='red', marker='X', alpha=0.7,
                           label="sub_optimal")
        axes[1, 0].set_ylabel('pH')

        # Dissolved Oxygen
        axes[1, 1].scatter(time,dissolved_oxygen, color='blue', marker='o', alpha=0.7,
                           label="optimal")
        axes[1, 1].set_ylabel('Dissolved Oxygen (DO) [%]')

        #Formatting
        for ax in np.ravel(axes):
            ax.set_xlabel('Time_h')
            ax.xaxis.set_major_locator(ticker.MultipleLocator(6))

        #Legends
        axes[0, 0].legend()
        axes[0, 1].legend()
        axes[1, 0].legend()

        fig.savefig(filepath)
        plt.close(fig)




    def export_summary(self, filepath):
        """
        Generates a batch summary table and exports it to a CSV file.

        Parameters
        ----------
        filepath : str
            Output CSV table path.

        Summary Table Columns
        ---------------------
        batch_id
            Batch identifier.

        ph_optimal_percent
            Percentage of measurements in a batch within the
            acceptable pH range, rounded to 2 decimal places.

        temperature_optimal_percent
            Percentage of measurements in a batch within the
            acceptable temperature range, rounded to 2 decimal places.

        C_product_g_L^-1_final
            Final product concentration for the batch.
        """
        records = []
        for batch_id in range(1,self.get_n_batches() + 1):
            df_batch = self.extract_batch(batch_id)

            ph_percent = np.round(100 * np.mean(self.optimal_ph_mask(df_batch)), 2)
            temperature_percent = np.round(100 * np.mean(self.optimal_temperature_mask(df_batch)), 2)
            product_final = df_batch.loc[:, 'C_product_g_L^-1'].to_numpy()[-1]
            records.append((batch_id, ph_percent, temperature_percent, product_final))

        column_names = ['batch_id', 'ph_optimal_percent', 'temperature_optimal_percent', 'C_product_g_L^-1_final']
        df_summary = pd.DataFrame(records, columns=column_names)
        df_summary.to_csv(filepath, index=False)


