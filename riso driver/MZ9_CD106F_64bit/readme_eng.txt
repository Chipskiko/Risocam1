                                                                               Jan. 2013
========================================================================================
About RISO Printer Driver for MZ9 Series
========================================================================================
                                                                 RISO KAGAKU CORPORATION

      -----------------------------------------------------------------------
       Read me before using the product
      -----------------------------------------------------------------------

[Contents]
 Information on operation
 Identified defects on printer drivers
 Restrictions on application software
 Trademarks
 Copyright

========================================================================================
Information on operation 
========================================================================================
 (1) The maximal print quantity of 9,999 can be specified for the RISO printer. Accordingly,
     if you specify the print quantity of more than maximum with certain application software,
     the specified value will be different from the actually printed quantity. Always specify
     the print quantity less than 10,000.

 (2) If you print originals (job) including multiple paper sizes at one time, proper printing 
     may not be made.

 (3) Extremely-light-color texts and illustrations may not be necessarily reproduced on the 
     print-out as they should be. If not reproduced as required, use darker colors for color 
     specification to reproduce them on the print-out.  

 (4) Extremely-light-color frame lines may not be necessarily reproduced on the print-out as 
     they should be. If not reproduced as required, use darker colors or use another type of 
     frame lines to reproduce them on the print-out.

 (5) When you install numbers of RISO Printer Driver in your computer, restart
     your computer after installing each driver. 

 (6) When re-installing the printer driver and/or utility software, be sure to uninstall the 
     existing ones first and restart your computer.

 (7) The Version numbers and Color support data shown in the "Printer Test Page" do not indicate 
     the current configuration of the selected printer driver but do the general information 
     given by the Windows system itself.

 (8) With some of the operation system and application in use, large sized-characters are not 
     treated as text data but as (photo) image data. Therefore, the image processing options for 
     text data such as "Solid-look" in the [Image] tab may not be available.

 (9) When you use a custom paper size, specify paper size and orientation in the [Properties]
     dialog box of the printer driver.

 (10) You may not change the settings of the printer driver with some of the application in use.
      If you cannot, the print conditions specified in the [Print] dialog box may not be reflected
      in the settings of printer drivers in certain application software programs, thus causing 
      unexpected print results. In that case, specify the same settings print conditions as given
      in the [Print] dialog box of the application software program with those concerned in the
      [Properties] dialog box of the corresponding printer driver. 

 (11) Unevenness of density may sometimes be seen in a part of photographs or illustrations when
      the "Backlight correction" has been specified as "ON".
      Try to solve the problem by the following methods.
       -Reduce the number of [Screen frequency] in the [Image] tab.
       -Take the checkmarks off from [Backlight correction] and [Edge enhancement] in the 
        [Photo adjustment].     
      If you use the application which has function to output the document as bit-mapped data, 
      output the document as bit-mapped format.

 (12) When images to be compressed block by block such as JPEG, PDF are printed with
      "Backlight correction" set to "ON", cyclic block noises may be generated.
      In that case, set "Backlight correction" to "OFF" or reduce the compression rate of images. 

 (13) When "Backlight correction" is set to be 3 or more, part of the photo in white may be tinted
      with color. In that case, lower "Backlight correction" to be 2 or less. 

 (14) Much of effect will not be given on photos with high resolution in Adobe(R), Page Maker(R),
      or other applications even if "Edge enhancement" is set to "ON". 

 (15) The object in gradation, in Adobe Illustrator (R), may have a noise in vertical direction. 
      In that case, set "Backlight correction" to "OFF" and set "Edge enhancement" to "OFF". 

 (16) When [Fit to Printer Margins] or [Reduce to Printer Margins] is set to "ON" and [Auto-Rotate 
      and Center] is also set to "ON" on the print dialog box with Adobe Acrobat or Adobe Reader, 
      block noises may be generated on the parts of photo. In that case, set "Backlight correction" 
      and "Edge enhancement" to "OFF".

 (17) If [Choose Paper Source by PDF page size] is set to "ON" on the print dialog box with Adobe 
      Acrobat or Acrobat Reader, the multiple pages data is split into one job per page. 
      In that case, set [Choose Paper Source by PDF page size] to "OFF".

 (18) When the page-reduce functions such as "2 UP" or "2 in 1" are set to [ON], a part of 
      characters or lines may not be printed properly.

========================================================================================
Identified defects on printer drivers
========================================================================================
 (1) Contact your local RISO service representative for the detailed information about the defects 
     described below or the actions to be taken against them.

 (2) When you enter the measurements of paper sizes, select the unit of measurement (mm or inch)
     first. 

 (3) Dotted frame lines may not be reproduced on the print-out with certain application software
     programs. In that case, use another type of frame lines such as bold dotted lines, broken 
     lines and solid lines.

 (4) When the [Apply] button is available in the current dialog box or tab, always click on it 
     to refresh the configuration data. Otherwise, the new configuration may be cancelled when
     you close the dialog box or tab concerned.

 (5) The decoration patterns shown on the computer display such as paint, graphic screen and text
     screen may appear differently when applied on the print-out.

 (6) When photo processing is set to "Grain-touch", noises may be generated on a part of photo.
     In that case, perform printing, selecting the "Screen-covered". 

 (7) For Custom paper entry, do not open nor save files with other extensions than UDP.

========================================================================================
Restrictions on application software
========================================================================================
 (1) When you specify more than one copy while selecting a multi-page (N-up) pattern as page layout
     in the [Print] dialog box on Microsoft Word 2000 or Microsoft Word2002, copies may be produced 
     in a wrong number or page frames may overlap on the print-out. In that case, specify only one 
     copy for this type of print job and repeat the same job as many times as required to produce 
     a desired number of copies.

     For details, refer to the Microsoft web site.

 (2) When an error occurs at the time of printing of the data from Microsoft Visio(R) 2000 or
     Microsoft Visio 2002, recovery from the error may be made possible with changing the spool
     data format to the RAW format. 
     For Windows 2000/XP: Proceed as [Advanced]-[Print Processor]-[Default data type] in the
     properties for the printer

     For details, refer to the Microsoft web site.

 (3) Note that there are some application software programs with in which the collating option remains
     active in any print job, thus causing RISO printers to make a master for each printed copy.

 (4) When the file with the size of the original other than A4, in Microsoft Word, is opened
     and the [Output size] is set to other than [Same as original], there might be a case where 
     the zoom up/down is not performed as specified. Such a case may be prevented with the
     procedures below.

     1. Specify the printer name as [RISO ...] in advance. When the different printer is selected, change 
        the printer's name in the print dialog box and click on the [Close].

     2. Display the [Print Preview] (selecting the [Print preview] from the menu) and click on the [Close]. 

     3. Perform printing after the [Print] dialog is opened (select the [Print] in the [File]) 
        and the [Properties] for the printer driver is set. 

     For details, refer to the Microsoft web site.

 (5) In Adobe PageMaker, there might be a case the right and bottom edges of the original are took in
     about 2 mm even though the [Margin-plus] is set to ON. This case may be prevented with the
     procedures below.

     1. Open the [Print] dialog box, open the [Properties] of the printer, set the [Margin-plus] to
        ON, and close the setting screen of the RISO Printer Driver.

     2. Press the [SHIFT] key with the [Print] dialog box in Adobe PageMaker displayed to turn the
        [Print] button to the [finish] button, and click the [finish] button to close the dialog box. 

     3. Reopen the [Print] dialog box to perform printing. 

 (6) Microsoft Visio, there might be a case where the right and bottom edges of the original are took 
     in about 2 mm even though the [Margin-plus] is set to ON. This case may be prevented with the
     procedures below.

     1. Open the [Print] dialog box, open the [Properties] of the printer, and set the function of
        the [Margin-plus] to "ON". And then close the setting screen for RISO Printer driver.

     2. Close the [Print] dialog box. 

     3. Re-open the [Print] dialog box and perform printing. 

 (7) In Adobe In Design(R), when printing is performed with combination of the original with the short
     side at the top, longer side at the top printing, paper with the shorter side at the top and with
     being set to [Multi-up (Plural)], the order of imposition differs from the one set with the
     [Properties] in the printer driver because the combination is processed as the original with the
     shorter side at the top, shorter side at the top printing, paper with the shorter side at the top.

 (8) Displayed patterns or texture are not identical with those on printed matters in some cases. 

     For details, refer to the Microsoft web site.

 (9) Under Microsoft Visio 2000 environment, if the translucent-processed illustrations are printed, 
     the noises might be generated on that area. Such a case may be prevented using the ServicePack2 of 
     Microsoft Visio 2000.

 (10) Under Microsoft Visio 2007 environment, an irregular size document (data) is treated as an A4-sized 
      document. Such a case may be prevented with the procedures below.

      1. Register irregular paper sizes as the standards on "Custom paper entry" of the printer driver.

      2. Open [Print Setup] in [File]-[Page Setup], and change the paper size of printer to the same size 
         of the original document.
         If the original document is multiple pages, change the sizes of all pages.

      3. Open the [Properties] dialog box on the [Print] dialog box and select the registered irregular 
         size at the "Original size", then click "OK" to close the dialog box.

      4. Close the [Print] dialog box.

      5. Reopen the [Print] dialog box and execute the print. 
          Do not open the [Properties] here. If you opened it, repeat the procedure from 2.

 (11) Under Microsoft PowerPoint(R) 2007 environment, if you check [High quality], 
      a part of illustrations are treated as photo image. 
      Therefore, the print result may be not same as you desired.

 (12) When the data including the translucent or transparent objects is continuously printed without 
      closing the application, you cannot obtain the constant print results. 
      If you print one and the same data continuously more than once, close the application after 
      each print.

 (13) Under Microsoft Word 2007 ServicePack3 environment on Windows XP,
     when photo processing is set to "Grain-touch", 
     the photo image may be output in extremely-light-color.
     In this case, it is recommended to select "Screen-covered" or 
     to create a PDF file from the original to print.

 (14) Under Microsoft Excel 2010 environment, 
     some parts of object (text, line, and photo) may not be processed properly
     and may yield poor results. (i.e. some parts of line object are processed as photo.) 
     In this case, it is recommended to create a PDF file from the original to print.

 (15) On Windows 8, 
     there might be a case that the[Read the User's Guide (PDF)] button does not work.
     In this case, please open the PDF file under [Manual] folder in the CD drive directly.

 (16) This product is designed for "Desktop Style", and does not work on "WinRT Style".

========================================================================================
Trademarks
========================================================================================
Microsoft, Windows, Excel, Visio and PowerPoint are registered trademarks or trademarks of Microsoft 
Corporation USA in United States of America and other countries.

Adobe, Acrobat, Adobe Reader, Illustrator, InDesign and PageMaker are registered trademarks or 
trademarks of Adobe Systems Incorporated in United States of America and other countries.

Other product names and company names referenced in this file are registered trademarks or trademarks 
of respective companies.

===============================================================================
Copyright
===============================================================================
Reproduction or copying of this instruction or any parts there of without
permission is strictly prohibited.

-------------------------------------------------------------------------------
Although every effort has been made to ensure that the contents of this
instruction are error-free, please contact us if you notice any error or
other points which should be brought to the company's attention.

Copyright (C) 2013 RISO KAGAKU CORPORATION, JAPAN
